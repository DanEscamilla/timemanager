import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/budget.dart';
import '../models/category.dart';
import '../services/budget_repository.dart';
import '../services/category_repository.dart';
import '../services/graphql_client.dart';
import '../utils/money.dart';
import 'budget_form_screen.dart';

class BudgetsScreen extends StatefulWidget {
  const BudgetsScreen({
    super.key,
    required this.budgetRepository,
    required this.categoryRepository,
    this.onChanged,
  });

  final BudgetRepository budgetRepository;
  final CategoryRepository categoryRepository;
  final VoidCallback? onChanged;

  @override
  State<BudgetsScreen> createState() => BudgetsScreenState();
}

class BudgetsScreenState extends State<BudgetsScreen> {
  late Future<_BudgetsData> _future;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _future = _load();
    });
  }

  Future<_BudgetsData> _load() async {
    final budgets = await widget.budgetRepository.fetchBudgets();
    final categories = await widget.categoryRepository.fetchCategories();
    return _BudgetsData(budgets: budgets, categories: categories);
  }

  Future<void> openCreateForm() => _openForm();

  Future<void> _openForm({Budget? budget}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BudgetFormScreen(
          budgetRepository: widget.budgetRepository,
          categoryRepository: widget.categoryRepository,
          budget: budget,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _confirmArchive(Budget budget) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.budgetsArchiveTitle),
          content: Text(dialogL10n.budgetsArchiveConfirm(budget.name)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.archive),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.budgetRepository.archiveBudget(budget.id);
      reload();
      widget.onChanged?.call();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    }
  }

  String _scopeLabel(AppLocalizations l10n, Budget budget, List<Category> categories) {
    if (budget.isTotal) return l10n.budgetsScopeTotal;
    final match = categories.where((c) => c.id == budget.categoryId);
    if (match.isEmpty) return l10n.budgetsScopeCategory;
    return match.first.name;
  }

  String _intervalLabel(AppLocalizations l10n, Budget budget) {
    return switch (budget.intervalUnit) {
      'day' => l10n.budgetsIntervalEveryDays(budget.intervalCount),
      'week' => l10n.budgetsIntervalEveryWeeks(budget.intervalCount),
      _ => l10n.budgetsIntervalEveryMonths(budget.intervalCount),
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return FutureBuilder<_BudgetsData>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const LoadingView();
        }
        if (snapshot.hasError) {
          return ErrorState(
            message: snapshot.error is GraphQLException
                ? (snapshot.error! as GraphQLException).localize(l10n)
                : l10n.errorCouldNotLoad,
            onRetry: reload,
            title: l10n.errorCouldNotLoad,
            retryLabel: l10n.errorRetry,
          );
        }

        final data = snapshot.data!;
        if (data.budgets.isEmpty) {
          return EmptyState(
            icon: Icons.account_balance_wallet_outlined,
            title: l10n.budgetsEmptyTitle,
            message: l10n.budgetsEmptyHint,
            actionLabel: l10n.budgetsEmptyAction,
            onAction: openCreateForm,
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.screen),
          itemCount: data.budgets.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final budget = data.budgets[index];
            return AppCard(
              child: ListTile(
                leading: Icon(
                  budget.isTotal
                      ? Icons.account_balance_wallet_outlined
                      : Icons.label_outline,
                ),
                title: Text(budget.name),
                subtitle: Text(
                  '${_scopeLabel(l10n, budget, data.categories)} · '
                  '${formatMoney(budget.amountCents, currency: budget.currency)} · '
                  '${_intervalLabel(l10n, budget)} · '
                  '${l10n.budgetsAlertAt(budget.alertPercent)}',
                ),
                isThreeLine: true,
                trailing: PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'edit') {
                      _openForm(budget: budget);
                    } else if (value == 'archive') {
                      _confirmArchive(budget);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text(l10n.budgetsFormEdit),
                    ),
                    PopupMenuItem(
                      value: 'archive',
                      child: Text(l10n.archive),
                    ),
                  ],
                ),
                onTap: () => _openForm(budget: budget),
              ),
            );
          },
        );
      },
    );
  }
}

class _BudgetsData {
  const _BudgetsData({required this.budgets, required this.categories});

  final List<Budget> budgets;
  final List<Category> categories;
}

import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/category.dart';
import '../models/expense.dart';
import '../services/category_repository.dart';
import '../services/expense_repository.dart';
import '../services/graphql_client.dart';
import '../services/mailbox_repository.dart';
import '../utils/money.dart';
import '../widgets/expense_review_tab.dart';
import 'expense_form_screen.dart';

class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({
    super.key,
    required this.expenseRepository,
    required this.categoryRepository,
    this.mailboxRepository,
    this.onChanged,
  });

  final ExpenseRepository expenseRepository;
  final CategoryRepository categoryRepository;
  final MailboxRepository? mailboxRepository;
  final VoidCallback? onChanged;

  @override
  State<ExpensesScreen> createState() => ExpensesScreenState();
}

class ExpensesScreenState extends State<ExpensesScreen>
    with SingleTickerProviderStateMixin {
  late Future<_ExpensesData> _future;
  late final TabController _tabs;
  final GlobalKey<ExpenseReviewTabState> _reviewKey =
      GlobalKey<ExpenseReviewTabState>();

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    reload();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  void reload() {
    setState(() {
      _future = _load();
    });
    _reviewKey.currentState?.reload();
  }

  Future<_ExpensesData> _load() async {
    final expenses = await widget.expenseRepository.fetchExpenses();
    final categories = await widget.categoryRepository.fetchCategories(
      includeArchived: true,
    );
    final byId = {for (final c in categories) c.id: c};
    return _ExpensesData(expenses: expenses, categoriesById: byId);
  }

  Future<void> openCreateForm() => _openForm();

  Future<void> _openForm({Expense? expense}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ExpenseFormScreen(
          expenseRepository: widget.expenseRepository,
          categoryRepository: widget.categoryRepository,
          mailboxRepository: widget.mailboxRepository,
          expense: expense,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _confirmDelete(Expense expense) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.expensesDeleteTitle),
          content: Text(dialogL10n.expensesDeleteConfirm),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.delete),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.expenseRepository.deleteExpense(expense.id);
      reload();
      widget.onChanged?.call();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final mailboxRepo = widget.mailboxRepository;

    return Column(
      children: [
        TabBar(
          controller: _tabs,
          tabs: [
            Tab(text: l10n.expensesTabHistory),
            Tab(text: l10n.expensesTabReview),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _buildHistory(l10n),
              mailboxRepo == null
                  ? Center(child: Text(l10n.errorCouldNotLoad))
                  : ExpenseReviewTab(
                      key: _reviewKey,
                      mailboxRepository: mailboxRepo,
                      categoryRepository: widget.categoryRepository,
                      onAccepted: () {
                        reload();
                        widget.onChanged?.call();
                      },
                    ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildHistory(AppLocalizations l10n) {
    return FutureBuilder<_ExpensesData>(
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
        if (data.expenses.isEmpty) {
          return EmptyState(
            icon: Icons.payments_outlined,
            title: l10n.expensesEmptyTitle,
            message: l10n.expensesEmptyHint,
            actionLabel: l10n.expensesEmptyAction,
            onAction: openCreateForm,
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.screen),
          itemCount: data.expenses.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final expense = data.expenses[index];
            final category = data.categoriesById[expense.categoryId];
            return AppCard(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: category?.colorValue ??
                      Theme.of(context).colorScheme.primary,
                  child: const Icon(
                    Icons.attach_money,
                    color: Colors.white,
                    size: 18,
                  ),
                ),
                title: Text(
                  formatMoney(expense.amountCents, currency: expense.currency),
                ),
                subtitle: Text(
                  [
                    category?.name ?? '—',
                    dateOnly(expense.spentOn),
                    if (expense.note != null && expense.note!.isNotEmpty)
                      expense.note!,
                  ].join(' · '),
                ),
                trailing: PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'edit') {
                      _openForm(expense: expense);
                    } else if (value == 'delete') {
                      _confirmDelete(expense);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: 'edit',
                      child: Text(l10n.expensesFormEdit),
                    ),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text(l10n.delete),
                    ),
                  ],
                ),
                onTap: () => _openForm(expense: expense),
              ),
            );
          },
        );
      },
    );
  }
}

class _ExpensesData {
  const _ExpensesData({
    required this.expenses,
    required this.categoriesById,
  });

  final List<Expense> expenses;
  final Map<int, Category> categoriesById;
}

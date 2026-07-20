import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/budget.dart';
import '../models/expense.dart';
import '../services/budget_repository.dart';
import '../services/expense_repository.dart';
import '../services/graphql_client.dart';
import '../utils/money.dart';

class OverviewScreen extends StatefulWidget {
  const OverviewScreen({
    super.key,
    required this.expenseRepository,
    required this.budgetRepository,
  });

  final ExpenseRepository expenseRepository;
  final BudgetRepository budgetRepository;

  @override
  State<OverviewScreen> createState() => OverviewScreenState();
}

class OverviewScreenState extends State<OverviewScreen> {
  late Future<_OverviewData> _future;

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

  Future<_OverviewData> _load() async {
    final now = DateTime.now();
    final totals = await widget.expenseRepository.fetchTotals(
      fromDate: dateOnly(monthStart(now)),
      toDate: dateOnly(monthEnd(now)),
    );
    final budgets = await widget.budgetRepository.fetchStatuses();
    return _OverviewData(totals: totals, budgets: budgets);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return FutureBuilder<_OverviewData>(
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
        final totals = data.totals;
        final budgets = data.budgets;
        final grandTotal = totals.fold<int>(0, (sum, t) => sum + t.totalCents);
        final currency = totals.isNotEmpty ? totals.first.currency : 'USD';

        return ListView(
          padding: const EdgeInsets.all(AppSpacing.screen),
          children: [
            Text(l10n.overviewTitle, style: theme.textTheme.headlineSmall),
            const SizedBox(height: AppSpacing.lg),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.overviewTotal, style: theme.textTheme.titleMedium),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    formatMoney(grandTotal, currency: currency),
                    style: theme.textTheme.headlineMedium,
                  ),
                ],
              ),
            ),
            if (budgets.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.lg),
              Text(l10n.overviewBudgets, style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.md),
              ...budgets.map((status) => _BudgetProgressCard(status: status)),
            ],
            const SizedBox(height: AppSpacing.lg),
            Text(l10n.overviewByCategory, style: theme.textTheme.titleMedium),
            const SizedBox(height: AppSpacing.md),
            if (totals.isEmpty)
              Text(l10n.overviewEmpty)
            else
              ...totals.map(
                (total) => Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: AppCard(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: parseEntityColor(total.categoryColor),
                        radius: 12,
                      ),
                      title: Text(total.categoryName),
                      trailing: Text(
                        formatMoney(
                          total.totalCents,
                          currency: total.currency,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _BudgetProgressCard extends StatelessWidget {
  const _BudgetProgressCard({required this.status});

  final BudgetStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final progress = (status.percentUsed / 100).clamp(0.0, 1.0);
    final warn = status.alertTriggered;
    final color = warn ? theme.colorScheme.error : theme.colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    status.budgetName,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                Text(
                  '${status.percentUsed}%',
                  style: theme.textTheme.titleSmall?.copyWith(color: color),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            LinearProgressIndicator(
              value: progress,
              color: color,
              backgroundColor: theme.colorScheme.surfaceContainerHighest,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              '${formatMoney(status.spentCents, currency: status.currency)} / '
              '${formatMoney(status.amountCents, currency: status.currency)}',
              style: theme.textTheme.bodyMedium,
            ),
            if (warn) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                l10n.overviewBudgetAlert(status.alertPercent),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OverviewData {
  const _OverviewData({required this.totals, required this.budgets});

  final List<ExpenseTotal> totals;
  final List<BudgetStatus> budgets;
}

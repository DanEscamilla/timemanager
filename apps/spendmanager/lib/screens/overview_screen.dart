import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/category.dart';
import '../models/expense.dart';
import '../services/expense_repository.dart';
import '../utils/money.dart';

class OverviewScreen extends StatefulWidget {
  const OverviewScreen({
    super.key,
    required this.expenseRepository,
  });

  final ExpenseRepository expenseRepository;

  @override
  State<OverviewScreen> createState() => OverviewScreenState();
}

class OverviewScreenState extends State<OverviewScreen> {
  late Future<List<ExpenseTotal>> _future;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    final now = DateTime.now();
    setState(() {
      _future = widget.expenseRepository.fetchTotals(
        fromDate: dateOnly(monthStart(now)),
        toDate: dateOnly(monthEnd(now)),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return FutureBuilder<List<ExpenseTotal>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l10n.errorCouldNotLoad),
                const SizedBox(height: AppSpacing.md),
                FilledButton(
                  onPressed: reload,
                  child: Text(l10n.errorRetry),
                ),
              ],
            ),
          );
        }

        final totals = snapshot.data ?? [];
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
                        backgroundColor: parseCategoryColor(total.categoryColor),
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

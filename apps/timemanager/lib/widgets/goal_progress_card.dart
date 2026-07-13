import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/goal.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import 'app_card.dart';

/// Compact goal progress card for lists and dashboard strips.
class GoalProgressCard extends StatelessWidget {
  const GoalProgressCard({
    super.key,
    required this.goal,
    this.onTap,
    this.compact = false,
  });

  final Goal goal;
  final VoidCallback? onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final cycle = goal.activeCycle;
    final ratio = goal.progressRatio;
    final percent = (ratio * 100).round();
    final remaining = cycle?.remaining ??
        (cycle != null
            ? (cycle.targetValue - cycle.currentValue).clamp(0, double.infinity)
            : goal.targetValue);

    final deadlineChip = _deadlineChip(context, cycle?.deadlineState, l10n);

    return AppCard(
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.borderMd,
        child: Padding(
          padding: EdgeInsets.all(compact ? AppSpacing.sm : AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 4,
                    height: compact ? 28 : 36,
                    decoration: BoxDecoration(
                      color: goal.colorValue,
                      borderRadius: AppRadius.borderPill,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          goal.title,
                          style: theme.textTheme.titleMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (!compact) ...[
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            _ruleLabel(goal.ruleType, l10n),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (goal.isLocked)
                    Icon(
                      Icons.lock_outline,
                      size: 18,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  if (goal.recurrence != null)
                    Padding(
                      padding: const EdgeInsets.only(left: AppSpacing.xs),
                      child: Icon(
                        Icons.repeat,
                        size: 16,
                        color: theme.colorScheme.tertiary,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              ClipRRect(
                borderRadius: AppRadius.borderPill,
                child: LinearProgressIndicator(
                  value: ratio,
                  minHeight: 8,
                  backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  color: goal.colorValue,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Text(
                    l10n.goalsProgressPercent(percent),
                    style: theme.textTheme.labelMedium,
                  ),
                  const Spacer(),
                  Text(
                    goal.metric == GoalMetric.duration
                        ? l10n.goalsRemainingMinutes(remaining.round())
                        : l10n.goalsRemainingCount(remaining.round()),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
              if (goal.isScheduled) ...[
                const SizedBox(height: AppSpacing.sm),
                Align(
                  alignment: Alignment.centerLeft,
                  child: _scheduledChip(context, goal, l10n),
                ),
              ] else if (deadlineChip != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Align(alignment: Alignment.centerLeft, child: deadlineChip),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _scheduledChip(
    BuildContext context,
    Goal goal,
    AppLocalizations l10n,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final days = goal.daysUntilStart();
    final label = days <= 0
        ? l10n.goalsStartsToday
        : days == 1
            ? l10n.goalsStartsTomorrow
            : l10n.goalsStartsInDays(days);
    return Chip(
      avatar: Icon(Icons.schedule, size: 14, color: scheme.primary),
      label: Text(label),
      visualDensity: VisualDensity.compact,
      backgroundColor: scheme.primary.withValues(alpha: 0.12),
      labelStyle: TextStyle(color: scheme.primary, fontSize: 12),
      side: BorderSide.none,
      padding: EdgeInsets.zero,
    );
  }

  Widget? _deadlineChip(
    BuildContext context,
    String? state,
    AppLocalizations l10n,
  ) {
    if (state == null || state == 'on_track') return null;
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (state) {
      'approaching' => (l10n.goalsDeadlineApproaching, scheme.tertiary),
      'overdue' => (l10n.goalsDeadlineOverdue, scheme.error),
      'failed' => (l10n.goalsDeadlineFailed, scheme.error),
      _ => (state, scheme.outline),
    };
    return Chip(
      label: Text(label),
      visualDensity: VisualDensity.compact,
      backgroundColor: color.withValues(alpha: 0.15),
      labelStyle: TextStyle(color: color, fontSize: 12),
      side: BorderSide.none,
      padding: EdgeInsets.zero,
    );
  }

  String _ruleLabel(GoalRuleType type, AppLocalizations l10n) {
    return switch (type) {
      GoalRuleType.activityCount => l10n.goalsRuleActivityCount,
      GoalRuleType.activityDuration => l10n.goalsRuleActivityDuration,
      GoalRuleType.groupDuration => l10n.goalsRuleGroupDuration,
      GoalRuleType.groupCount => l10n.goalsRuleGroupCount,
      GoalRuleType.groupAnyCount => l10n.goalsRuleGroupAnyCount,
      GoalRuleType.groupAllComplete => l10n.goalsRuleGroupAllComplete,
      GoalRuleType.multiActivityDuration => l10n.goalsRuleMultiDuration,
      GoalRuleType.streak => l10n.goalsRuleStreak,
      GoalRuleType.timeOfDayCount => l10n.goalsRuleTimeOfDay,
      GoalRuleType.composite => l10n.goalsRuleComposite,
    };
  }
}

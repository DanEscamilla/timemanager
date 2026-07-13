import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../models/goal.dart';
import '../services/activity_repository.dart';
import '../services/goal_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_breakpoints.dart';
import '../theme/tokens/app_spacing.dart';
import '../utils/overview_stats.dart';
import '../widgets/activity_list_tile.dart';
import '../widgets/app_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/goal_progress_card.dart';
import '../widgets/loading_view.dart';
import '../widgets/stat_card.dart';
import 'activity_form_screen.dart';

class _OverviewData {
  const _OverviewData({
    required this.activities,
    required this.goals,
    required this.daily,
    required this.nudges,
    required this.completionsByActivity,
  });

  final List<Activity> activities;
  final List<Goal> goals;
  final DailyProgress daily;
  final List<GoalNudge> nudges;
  final Map<int, ActivityCompletion> completionsByActivity;
}

/// Dashboard tab: greeting, daily progress, goals, today's schedule, upcoming.
class OverviewScreen extends StatefulWidget {
  const OverviewScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    required this.goalRepository,
    required this.completionRepository,
    this.onOpenCalendar,
    this.onOpenActivities,
    this.onOpenGoals,
    this.onChanged,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;
  final GoalRepository goalRepository;
  final CompletionRepository completionRepository;
  final VoidCallback? onOpenCalendar;
  final VoidCallback? onOpenActivities;
  final VoidCallback? onOpenGoals;
  final VoidCallback? onChanged;

  @override
  State<OverviewScreen> createState() => OverviewScreenState();
}

class OverviewScreenState extends State<OverviewScreen> {
  late Future<_OverviewData> _dataFuture;

  @override
  void initState() {
    super.initState();
    reload();
  }

  String _todayIso() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }

  Future<_OverviewData> _load() async {
    final today = _todayIso();
    final activities = await widget.repository.fetchActivities();
    final goals = await widget.goalRepository.fetchGoals();
    final daily = await widget.goalRepository.fetchDailyProgress(date: today);
    final nudges = await widget.goalRepository.fetchNudges();
    final completions = await widget.completionRepository.fetchCompletions(
      fromDate: today,
      toDate: today,
    );
    final byActivity = <int, ActivityCompletion>{};
    for (final c in completions) {
      byActivity[c.activityId] = c;
    }
    return _OverviewData(
      activities: activities,
      goals: goals.where((g) => g.status == GoalStatus.active).toList(),
      daily: daily,
      nudges: nudges,
      completionsByActivity: byActivity,
    );
  }

  void reload() {
    setState(() {
      _dataFuture = _load();
    });
  }

  Future<void> openCreateForm() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ActivityFormScreen(
          repository: widget.repository,
          groupRepository: widget.groupRepository,
          initialDate: DateTime.now(),
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _openActivity(Activity activity) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ActivityFormScreen(
          repository: widget.repository,
          groupRepository: widget.groupRepository,
          activity: activity,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _markDone(Activity activity) async {
    await widget.completionRepository.completeActivity(
      activityId: activity.id,
      occurrenceDate: _todayIso(),
    );
    reload();
    widget.onChanged?.call();
  }

  Future<void> _undoDone(ActivityCompletion completion) async {
    await widget.completionRepository.undoCompletion(completion.id);
    reload();
    widget.onChanged?.call();
  }

  Future<void> _logTime(Activity activity) async {
    final l10n = AppLocalizations.of(context);
    final controller = TextEditingController(text: '30');
    final minutes = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.logTimeTitle),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: l10n.logTimeMinutes),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.activitiesCancel),
          ),
          FilledButton(
            onPressed: () {
              final n = int.tryParse(controller.text.trim());
              if (n == null || n <= 0) return;
              Navigator.pop(context, n);
            },
            child: Text(l10n.logTimeSave),
          ),
        ],
      ),
    );
    if (minutes == null) return;
    await widget.completionRepository.logTime(
      activityId: activity.id,
      durationMinutes: minutes,
      occurrenceDate: _todayIso(),
    );
    reload();
    widget.onChanged?.call();
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return FutureBuilder<_OverviewData>(
      future: _dataFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const LoadingView();
        }

        if (snapshot.hasError) {
          return ErrorState(
            message: _errorMessage(snapshot.error, l10n),
            onRetry: reload,
          );
        }

        final data = snapshot.data!;
        final stats = buildOverviewStats(data.activities);
        final locale = Localizations.localeOf(context).toString();
        final dateLabel = DateFormat.yMMMMEEEEd(locale).format(DateTime.now());
        final plannedToday = stats.todayCount;
        final completionPct = plannedToday == 0
            ? 0
            : ((data.daily.completedCount / plannedToday) * 100)
                .clamp(0, 100)
                .round();

        return LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= AppBreakpoints.medium;
            return RefreshIndicator(
              onRefresh: () async {
                reload();
                await _dataFuture;
              },
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.screen),
                children: [
                  Text(
                    l10n.overviewGreeting,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    l10n.overviewTodayDate(dateLabel),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _DailyStatsRow(
                    daily: data.daily,
                    completionPct: completionPct,
                    wide: wide,
                  ),
                  if (data.nudges.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.md),
                    _NudgesCard(nudges: data.nudges),
                  ],
                  if (data.goals.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.md),
                    _ActiveGoalsStrip(
                      goals: data.goals.take(4).toList(),
                      onOpenGoals: widget.onOpenGoals,
                    ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                  if (wide)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _TodayCard(
                            stats: stats,
                            completions: data.completionsByActivity,
                            onAdd: openCreateForm,
                            onOpen: _openActivity,
                            onMarkDone: _markDone,
                            onUndo: _undoDone,
                            onLogTime: _logTime,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: _UpcomingCard(
                            stats: stats,
                            onOpen: _openActivity,
                            onViewAll: widget.onOpenActivities,
                          ),
                        ),
                      ],
                    )
                  else ...[
                    _TodayCard(
                      stats: stats,
                      completions: data.completionsByActivity,
                      onAdd: openCreateForm,
                      onOpen: _openActivity,
                      onMarkDone: _markDone,
                      onUndo: _undoDone,
                      onLogTime: _logTime,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _UpcomingCard(
                      stats: stats,
                      onOpen: _openActivity,
                      onViewAll: widget.onOpenActivities,
                    ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                  _QuickActionsCard(
                    onAdd: openCreateForm,
                    onOpenCalendar: widget.onOpenCalendar,
                    onOpenGoals: widget.onOpenGoals,
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _DailyStatsRow extends StatelessWidget {
  const _DailyStatsRow({
    required this.daily,
    required this.completionPct,
    required this.wide,
  });

  final DailyProgress daily;
  final int completionPct;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cards = [
      StatCard(
        label: l10n.overviewDailyProgress,
        value: '$completionPct%',
        caption: l10n.overviewStatCompleted,
        icon: Icons.check_circle_outline,
      ),
      StatCard(
        label: l10n.overviewStatMinutes,
        value: '${daily.minutesToday.round()}',
        icon: Icons.timer_outlined,
      ),
      StatCard(
        label: l10n.overviewStatStreak,
        value: '${daily.streakDays}',
        icon: Icons.local_fire_department_outlined,
      ),
    ];

    if (wide) {
      return Row(
        children: [
          for (var i = 0; i < cards.length; i++) ...[
            if (i > 0) const SizedBox(width: AppSpacing.md),
            Expanded(child: cards[i]),
          ],
        ],
      );
    }

    return Column(
      children: [
        for (var i = 0; i < cards.length; i++) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm),
          cards[i],
        ],
      ],
    );
  }
}

class _NudgesCard extends StatelessWidget {
  const _NudgesCard({required this.nudges});

  final List<GoalNudge> nudges;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.goalsNudges, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.sm),
          for (final nudge in nudges.take(3))
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                switch (nudge.severity) {
                  'warning' => Icons.warning_amber_outlined,
                  'success' => Icons.celebration_outlined,
                  _ => Icons.info_outline,
                },
                color: switch (nudge.severity) {
                  'warning' => theme.colorScheme.error,
                  'success' => theme.colorScheme.primary,
                  _ => theme.colorScheme.tertiary,
                },
              ),
              title: Text(nudge.message),
            ),
        ],
      ),
    );
  }
}

class _ActiveGoalsStrip extends StatelessWidget {
  const _ActiveGoalsStrip({
    required this.goals,
    this.onOpenGoals,
  });

  final List<Goal> goals;
  final VoidCallback? onOpenGoals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.goalsActiveStrip,
                style: theme.textTheme.titleLarge,
              ),
            ),
            if (onOpenGoals != null)
              TextButton(
                onPressed: onOpenGoals,
                child: Text(l10n.goalsViewAll),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        ...goals.map(
          (g) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: GoalProgressCard(goal: g, compact: true),
          ),
        ),
      ],
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({
    required this.stats,
    required this.completions,
    required this.onAdd,
    required this.onOpen,
    required this.onMarkDone,
    required this.onUndo,
    required this.onLogTime,
  });

  final OverviewStats stats;
  final Map<int, ActivityCompletion> completions;
  final VoidCallback onAdd;
  final ValueChanged<Activity> onOpen;
  final ValueChanged<Activity> onMarkDone;
  final ValueChanged<ActivityCompletion> onUndo;
  final ValueChanged<Activity> onLogTime;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.overviewTodaySchedule,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: AppSpacing.md),
          if (stats.todayOccurrences.isEmpty)
            EmptyState(
              icon: Icons.event_available_outlined,
              title: l10n.overviewEmptyToday,
              message: l10n.overviewEmptyTodayHint,
              actionLabel: l10n.overviewAddActivity,
              onAction: onAdd,
              compact: true,
            )
          else
            ...stats.todayOccurrences.map((occurrence) {
              final activity = occurrence.activity;
              final completion = completions[activity.id];
              final done = completion != null;
              return Column(
                children: [
                  ActivityListTile(
                    activity: activity,
                    scheduleOverride:
                        '${activity.startTime} – ${activity.endTime}',
                    compact: true,
                    showMenu: false,
                    onTap: () => onOpen(activity),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Wrap(
                      spacing: AppSpacing.xs,
                      children: [
                        if (done)
                          TextButton.icon(
                            onPressed: () => onUndo(completion),
                            icon: const Icon(Icons.undo, size: 16),
                            label: Text(l10n.overviewUndoDone),
                          )
                        else
                          TextButton.icon(
                            onPressed: () => onMarkDone(activity),
                            icon: const Icon(Icons.check, size: 16),
                            label: Text(l10n.overviewMarkDone),
                          ),
                        TextButton.icon(
                          onPressed: () => onLogTime(activity),
                          icon: const Icon(Icons.timer_outlined, size: 16),
                          label: Text(l10n.overviewLogTime),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }),
        ],
      ),
    );
  }
}

class _UpcomingCard extends StatelessWidget {
  const _UpcomingCard({
    required this.stats,
    required this.onOpen,
    this.onViewAll,
  });

  final OverviewStats stats;
  final ValueChanged<Activity> onOpen;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toString();
    final dateFormat = DateFormat.MMMd(locale);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.overviewUpcoming,
                  style: theme.textTheme.titleLarge,
                ),
              ),
              if (onViewAll != null)
                TextButton(
                  onPressed: onViewAll,
                  child: Text(l10n.overviewViewAll),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          if (stats.upcomingOccurrences.isEmpty)
            Text(
              l10n.overviewEmptyUpcoming,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          else
            ...stats.upcomingOccurrences.map(
              (occurrence) => ActivityListTile(
                activity: occurrence.activity,
                scheduleOverride:
                    '${dateFormat.format(occurrence.date)} · ${occurrence.activity.startTime}',
                compact: true,
                showMenu: false,
                onTap: () => onOpen(occurrence.activity),
              ),
            ),
        ],
      ),
    );
  }
}

class _QuickActionsCard extends StatelessWidget {
  const _QuickActionsCard({
    required this.onAdd,
    this.onOpenCalendar,
    this.onOpenGoals,
  });

  final VoidCallback onAdd;
  final VoidCallback? onOpenCalendar;
  final VoidCallback? onOpenGoals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.overviewQuickActions,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              FilledButton.icon(
                onPressed: onAdd,
                icon: const Icon(Icons.add),
                label: Text(l10n.overviewAddActivity),
              ),
              if (onOpenCalendar != null)
                OutlinedButton.icon(
                  onPressed: onOpenCalendar,
                  icon: const Icon(Icons.calendar_today_outlined),
                  label: Text(l10n.overviewOpenCalendar),
                ),
              if (onOpenGoals != null)
                OutlinedButton.icon(
                  onPressed: onOpenGoals,
                  icon: const Icon(Icons.flag_outlined),
                  label: Text(l10n.goalsViewAll),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

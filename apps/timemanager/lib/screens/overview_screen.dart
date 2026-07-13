import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_breakpoints.dart';
import '../theme/tokens/app_spacing.dart';
import '../utils/overview_stats.dart';
import '../widgets/activity_list_tile.dart';
import '../widgets/app_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import '../widgets/stat_card.dart';
import 'activity_form_screen.dart';

/// Dashboard tab: greeting, stats, today's schedule, upcoming, quick actions.
class OverviewScreen extends StatefulWidget {
  const OverviewScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    this.onOpenCalendar,
    this.onOpenActivities,
    this.onChanged,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;
  final VoidCallback? onOpenCalendar;
  final VoidCallback? onOpenActivities;
  final VoidCallback? onChanged;

  @override
  State<OverviewScreen> createState() => OverviewScreenState();
}

class OverviewScreenState extends State<OverviewScreen> {
  late Future<List<Activity>> _activitiesFuture;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _activitiesFuture = widget.repository.fetchActivities();
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

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return FutureBuilder<List<Activity>>(
      future: _activitiesFuture,
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

        final activities = snapshot.data ?? [];
        final stats = buildOverviewStats(activities);
        final locale = Localizations.localeOf(context).toString();
        final dateLabel = DateFormat.yMMMMEEEEd(locale).format(DateTime.now());

        return LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= AppBreakpoints.medium;
            return RefreshIndicator(
              onRefresh: () async {
                setState(() {
                  _activitiesFuture = widget.repository.fetchActivities();
                });
                await _activitiesFuture;
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
                  _StatsRow(stats: stats, wide: wide),
                  const SizedBox(height: AppSpacing.md),
                  if (wide)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: _TodayCard(
                          stats: stats,
                          onAdd: openCreateForm,
                          onOpen: _openActivity,
                        )),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(child: _UpcomingCard(
                          stats: stats,
                          onOpen: _openActivity,
                          onViewAll: widget.onOpenActivities,
                        )),
                      ],
                    )
                  else ...[
                    _TodayCard(
                      stats: stats,
                      onAdd: openCreateForm,
                      onOpen: _openActivity,
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

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats, required this.wide});

  final OverviewStats stats;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cards = [
      StatCard(
        label: l10n.overviewStatToday,
        value: '${stats.todayCount}',
        icon: Icons.today_outlined,
      ),
      StatCard(
        label: l10n.overviewStatWeek,
        value: '${stats.weekCount}',
        icon: Icons.date_range_outlined,
      ),
      StatCard(
        label: l10n.overviewStatRecurring,
        value: '${stats.recurringCount}',
        icon: Icons.repeat,
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

class _TodayCard extends StatelessWidget {
  const _TodayCard({
    required this.stats,
    required this.onAdd,
    required this.onOpen,
  });

  final OverviewStats stats;
  final VoidCallback onAdd;
  final ValueChanged<Activity> onOpen;

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
            ...stats.todayOccurrences.map(
              (occurrence) => ActivityListTile(
                activity: occurrence.activity,
                scheduleOverride:
                    '${occurrence.activity.startTime} – ${occurrence.activity.endTime}',
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
  });

  final VoidCallback onAdd;
  final VoidCallback? onOpenCalendar;

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
            ],
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/goal.dart';
import '../services/activity_repository.dart';
import '../services/goal_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../services/reward_repository.dart';
import '../widgets/goal_progress_card.dart';
import 'goal_detail_screen.dart';
import 'goal_form_screen.dart';

/// Goals tab: sectioned list with filters.
class GoalsScreen extends StatefulWidget {
  const GoalsScreen({
    super.key,
    required this.goalRepository,
    required this.activityRepository,
    required this.groupRepository,
    this.rewardRepository,
    this.onChanged,
  });

  final GoalRepository goalRepository;
  final ActivityRepository activityRepository;
  final GroupRepository groupRepository;
  final RewardRepository? rewardRepository;
  final VoidCallback? onChanged;

  @override
  State<GoalsScreen> createState() => GoalsScreenState();
}

class GoalsScreenState extends State<GoalsScreen> {
  late Future<List<Goal>> _goalsFuture;
  String _filter = 'active';

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _goalsFuture = widget.goalRepository.fetchGoals();
    });
  }

  Future<void> openCreateForm() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => GoalFormScreen(
          goalRepository: widget.goalRepository,
          activityRepository: widget.activityRepository,
          groupRepository: widget.groupRepository,
          rewardRepository: widget.rewardRepository,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _openDetail(Goal goal) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => GoalDetailScreen(
          goalId: goal.id,
          goalRepository: widget.goalRepository,
          activityRepository: widget.activityRepository,
          groupRepository: widget.groupRepository,
          rewardRepository: widget.rewardRepository,
        ),
      ),
    );
    if (changed == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  List<Goal> _filtered(List<Goal> goals) {
    return switch (_filter) {
      'scheduled' => goals
          .where((g) => g.lifecyclePhase == GoalLifecyclePhase.scheduled)
          .toList(),
      'paused' => goals.where((g) => g.status == GoalStatus.paused).toList(),
      'completed' =>
        goals.where((g) => g.status == GoalStatus.completed).toList(),
      'archived' =>
        goals.where((g) => g.status == GoalStatus.archived).toList(),
      'all' => goals,
      // Active filter: accruing only (exclude scheduled).
      _ => goals
          .where((g) => g.lifecyclePhase == GoalLifecyclePhase.active)
          .toList(),
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.md,
            AppSpacing.xs,
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'active', label: Text(l10n.goalsFilterActive)),
                ButtonSegment(
                  value: 'scheduled',
                  label: Text(l10n.goalsFilterScheduled),
                ),
                ButtonSegment(value: 'paused', label: Text(l10n.goalsFilterPaused)),
                ButtonSegment(
                  value: 'completed',
                  label: Text(l10n.goalsFilterCompleted),
                ),
                ButtonSegment(
                  value: 'archived',
                  label: Text(l10n.goalsFilterArchived),
                ),
                ButtonSegment(value: 'all', label: Text(l10n.goalsFilterAll)),
              ],
              selected: {_filter},
              onSelectionChanged: (s) => setState(() => _filter = s.single),
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Goal>>(
            future: _goalsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const LoadingView();
              }
              if (snapshot.hasError) {
                return ErrorState(
                  message: _errorMessage(snapshot.error, l10n),
                  onRetry: reload,
                  title: l10n.errorCouldNotLoadActivities,
                  retryLabel: l10n.errorRetry,
                );
              }

              final goals = _filtered(snapshot.data ?? []);
              if (goals.isEmpty) {
                return EmptyState(
                  icon: Icons.flag_outlined,
                  title: l10n.goalsEmptyTitle,
                  message: l10n.goalsEmptyHint,
                  actionLabel: l10n.goalsEmptyAction,
                  onAction: openCreateForm,
                );
              }

              return RefreshIndicator(
                onRefresh: () async {
                  reload();
                  await _goalsFuture;
                },
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.screen),
                  itemCount: goals.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, index) {
                    final goal = goals[index];
                    return GoalProgressCard(
                      goal: goal,
                      onTap: () => _openDetail(goal),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

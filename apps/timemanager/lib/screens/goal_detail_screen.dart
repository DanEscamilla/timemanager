import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/goal.dart';
import '../services/activity_repository.dart';
import '../services/goal_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/app_card.dart';
import '../widgets/error_state.dart';
import '../widgets/goal_progress_card.dart';
import '../widgets/loading_view.dart';
import 'goal_form_screen.dart';

class GoalDetailScreen extends StatefulWidget {
  const GoalDetailScreen({
    super.key,
    required this.goalId,
    required this.goalRepository,
    required this.activityRepository,
    required this.groupRepository,
  });

  final int goalId;
  final GoalRepository goalRepository;
  final ActivityRepository activityRepository;
  final GroupRepository groupRepository;

  @override
  State<GoalDetailScreen> createState() => _GoalDetailScreenState();
}

class _GoalDetailScreenState extends State<GoalDetailScreen> {
  late Future<Goal?> _future;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _future = widget.goalRepository.fetchGoal(widget.goalId);
    });
  }

  Future<void> _edit(Goal goal) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => GoalFormScreen(
          goalRepository: widget.goalRepository,
          activityRepository: widget.activityRepository,
          groupRepository: widget.groupRepository,
          goal: goal,
        ),
      ),
    );
    if (saved == true) {
      _changed = true;
      reload();
    }
  }

  Future<void> _pauseResume(Goal goal) async {
    if (goal.status == GoalStatus.active) {
      await widget.goalRepository.pauseGoal(goal.id);
    } else if (goal.status == GoalStatus.paused) {
      await widget.goalRepository.resumeGoal(goal.id);
    }
    _changed = true;
    reload();
  }

  Future<void> _archive(Goal goal) async {
    await widget.goalRepository.archiveGoal(goal.id);
    _changed = true;
    if (mounted) Navigator.of(context).pop(true);
  }

  Future<void> _delete(Goal goal) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.goalsDeleteTitle),
        content: Text(l10n.goalsDeleteConfirm(goal.title)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.activitiesCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.activitiesDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.goalRepository.deleteGoal(goal.id);
    if (mounted) Navigator.of(context).pop(true);
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.goalsDetailTitle),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(_changed),
          ),
        ),
        body: FutureBuilder<Goal?>(
          future: _future,
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
            final goal = snapshot.data;
            if (goal == null) {
              return ErrorState(
                message: l10n.goalsNotFound,
                onRetry: () => Navigator.pop(context),
              );
            }

            final cycle = goal.activeCycle;
            final ratio = goal.progressRatio;

            return ListView(
              padding: const EdgeInsets.all(AppSpacing.screen),
              children: [
                GoalProgressCard(goal: goal),
                const SizedBox(height: AppSpacing.md),
                AppCard(
                  child: Column(
                    children: [
                      SizedBox(
                        height: 140,
                        width: 140,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            CircularProgressIndicator(
                              value: ratio,
                              strokeWidth: 10,
                              backgroundColor:
                                  theme.colorScheme.surfaceContainerHighest,
                              color: goal.colorValue,
                            ),
                            Center(
                              child: Text(
                                '${(ratio * 100).round()}%',
                                style: theme.textTheme.headlineSmall,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (cycle != null)
                        Text(
                          l10n.goalsCycleSummary(
                            cycle.currentValue.round(),
                            cycle.targetValue.round(),
                          ),
                          style: theme.textTheme.bodyLarge,
                        ),
                    ],
                  ),
                ),
                if (goal.links.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.goalsLinkedSources,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        for (final link in goal.links)
                          ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              link.linkType == GoalLinkType.group
                                  ? Icons.folder_outlined
                                  : Icons.event_outlined,
                            ),
                            title: Text(
                              link.isDangling
                                  ? l10n.goalsDanglingLink
                                  : (link.activityTitle ??
                                      link.groupName ??
                                      '#${link.activityId ?? link.groupId}'),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
                if (goal.dependencies.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.goalsDependencies,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        for (final dep in goal.dependencies)
                          ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.account_tree_outlined),
                            title: Text(
                              dep.dependsOnTitle ??
                                  l10n.goalsDependencyId(dep.dependsOnGoalId),
                            ),
                            subtitle: Text(dep.requirement),
                          ),
                      ],
                    ),
                  ),
                ],
                if (goal.snapshots.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.goalsHistory,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        SizedBox(
                          height: 80,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              for (final snap in goal.snapshots.take(14))
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 2,
                                    ),
                                    child: FractionallySizedBox(
                                      heightFactor: cycle != null &&
                                              cycle.targetValue > 0
                                          ? (snap.value / cycle.targetValue)
                                              .clamp(0.05, 1)
                                          : 0.2,
                                      alignment: Alignment.bottomCenter,
                                      child: DecoratedBox(
                                        decoration: BoxDecoration(
                                          color: goal.colorValue,
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    FilledButton.icon(
                      onPressed: () => _edit(goal),
                      icon: const Icon(Icons.edit_outlined),
                      label: Text(l10n.activitiesEdit),
                    ),
                    if (goal.status == GoalStatus.active ||
                        goal.status == GoalStatus.paused)
                      OutlinedButton.icon(
                        onPressed: () => _pauseResume(goal),
                        icon: Icon(
                          goal.status == GoalStatus.active
                              ? Icons.pause
                              : Icons.play_arrow,
                        ),
                        label: Text(
                          goal.status == GoalStatus.active
                              ? l10n.goalsPause
                              : l10n.goalsResume,
                        ),
                      ),
                    OutlinedButton.icon(
                      onPressed: () => _archive(goal),
                      icon: const Icon(Icons.archive_outlined),
                      label: Text(l10n.goalsArchive),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _delete(goal),
                      icon: const Icon(Icons.delete_outline),
                      label: Text(l10n.activitiesDelete),
                    ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

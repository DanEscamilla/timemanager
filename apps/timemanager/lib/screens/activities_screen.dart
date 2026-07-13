import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/activity_list_tile.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import 'activity_form_screen.dart';

class ActivitiesScreen extends StatefulWidget {
  const ActivitiesScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    this.onChanged,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;

  /// Called after a successful create/update/delete so siblings can refresh.
  final VoidCallback? onChanged;

  @override
  State<ActivitiesScreen> createState() => ActivitiesScreenState();
}

class ActivitiesScreenState extends State<ActivitiesScreen> {
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

  Future<void> openCreateForm() => _openForm();

  Future<void> _openForm({Activity? activity}) async {
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

  Future<void> _confirmDelete(Activity activity) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.activitiesDeleteTitle),
          content: Text(dialogL10n.activitiesDeleteConfirm(activity.title)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.activitiesCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.activitiesDelete),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.repository.deleteActivity(activity.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.activitiesDeleted)),
      );
      reload();
      widget.onChanged?.call();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      final errorL10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(errorL10n))),
      );
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
        if (activities.isEmpty) {
          return EmptyState(
            icon: Icons.event_note_outlined,
            title: l10n.activitiesEmptyTitle,
            message: l10n.activitiesEmptyHint,
            actionLabel: l10n.activitiesEmptyAction,
            onAction: openCreateForm,
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            setState(() {
              _activitiesFuture = widget.repository.fetchActivities();
            });
            await _activitiesFuture;
          },
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            itemCount: activities.length,
            itemBuilder: (context, index) {
              final activity = activities[index];
              return ActivityListTile(
                activity: activity,
                onTap: () => _openForm(activity: activity),
                onEdit: () => _openForm(activity: activity),
                onDelete: () => _confirmDelete(activity),
              );
            },
          ),
        );
      },
    );
  }
}

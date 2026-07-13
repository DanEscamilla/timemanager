import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../utils/recurrence_summary.dart';
import 'activity_form_screen.dart';

class ActivitiesScreen extends StatefulWidget {
  const ActivitiesScreen({
    super.key,
    required this.repository,
    this.onSignedOut,
    this.embedded = false,
    this.onChanged,
  });

  final ActivityRepository repository;
  final Future<void> Function()? onSignedOut;

  /// When embedded in [HomeScreen], render body only (shell owns chrome).
  final bool embedded;

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

  Widget _buildBody() {
    final l10n = AppLocalizations.of(context);

    return FutureBuilder<List<Activity>>(
      future: _activitiesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return _ErrorState(
            message: _errorMessage(snapshot.error, l10n),
            onRetry: reload,
          );
        }

        final activities = snapshot.data ?? [];
        if (activities.isEmpty) {
          return Center(child: Text(l10n.activitiesEmpty));
        }

        return RefreshIndicator(
          onRefresh: () async {
            setState(() {
              _activitiesFuture = widget.repository.fetchActivities();
            });
            await _activitiesFuture;
          },
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: activities.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final activity = activities[index];
              final type = activity.recurrencePattern?.recurrenceType;
              return ListTile(
                title: Text(activity.title),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(formatActivitySchedule(activity, l10n)),
                    if (activity.description?.isNotEmpty == true)
                      Text(activity.description!),
                  ],
                ),
                isThreeLine: activity.description?.isNotEmpty == true,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (activity.isRecurring)
                      Padding(
                        padding: const EdgeInsets.only(right: 4),
                        child: Chip(
                          label: Text(
                            type != null
                                ? recurrenceTypeLabel(type, l10n)
                                : l10n.activitiesRecurring,
                          ),
                          visualDensity: VisualDensity.compact,
                        ),
                      ),
                    PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'edit') {
                          _openForm(activity: activity);
                        } else if (value == 'delete') {
                          _confirmDelete(activity);
                        }
                      },
                      itemBuilder: (context) {
                        final menuL10n = AppLocalizations.of(context);
                        return [
                          PopupMenuItem(
                            value: 'edit',
                            child: Text(menuL10n.activitiesEdit),
                          ),
                          PopupMenuItem(
                            value: 'delete',
                            child: Text(menuL10n.activitiesDelete),
                          ),
                        ];
                      },
                    ),
                  ],
                ),
                onTap: () => _openForm(activity: activity),
              );
            },
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final body = _buildBody();
    if (widget.embedded) return body;

    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.navActivities),
        actions: [
          IconButton(
            tooltip: l10n.tooltipRefresh,
            onPressed: reload,
            icon: const Icon(Icons.refresh),
          ),
          if (widget.onSignedOut != null)
            IconButton(
              tooltip: l10n.tooltipSignOut,
              onPressed: widget.onSignedOut,
              icon: const Icon(Icons.logout),
            ),
        ],
      ),
      body: body,
      floatingActionButton: FloatingActionButton(
        onPressed: openCreateForm,
        tooltip: l10n.tooltipAddActivity,
        child: const Icon(Icons.add),
      ),
    );
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off,
              size: 48,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              l10n.errorCouldNotLoadActivities,
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(l10n.errorRetry),
            ),
          ],
        ),
      ),
    );
  }
}

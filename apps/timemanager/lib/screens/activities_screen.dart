import 'package:flutter/material.dart';

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
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete activity?'),
        content: Text('Remove "${activity.title}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.repository.deleteActivity(activity.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Activity deleted')),
      );
      reload();
      widget.onChanged?.call();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    }
  }

  Widget _buildBody() {
    return FutureBuilder<List<Activity>>(
      future: _activitiesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return _ErrorState(
            message: _errorMessage(snapshot.error),
            onRetry: reload,
          );
        }

        final activities = snapshot.data ?? [];
        if (activities.isEmpty) {
          return const Center(
            child: Text('No activities yet.\nTap + to add one.'),
          );
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
              return ListTile(
                title: Text(activity.title),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(formatActivitySchedule(activity)),
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
                            activity.recurrencePattern?.recurrenceType.label ??
                                'Recurring',
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
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: 'edit', child: Text('Edit')),
                        PopupMenuItem(value: 'delete', child: Text('Delete')),
                      ],
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activities'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: reload,
            icon: const Icon(Icons.refresh),
          ),
          if (widget.onSignedOut != null)
            IconButton(
              tooltip: 'Sign out',
              onPressed: widget.onSignedOut,
              icon: const Icon(Icons.logout),
            ),
        ],
      ),
      body: body,
      floatingActionButton: FloatingActionButton(
        onPressed: openCreateForm,
        tooltip: 'Add activity',
        child: const Icon(Icons.add),
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error is GraphQLException) return error.message;
    return error?.toString() ?? 'Unknown error';
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
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
              'Could not load activities',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

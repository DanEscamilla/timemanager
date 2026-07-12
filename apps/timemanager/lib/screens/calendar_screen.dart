import 'package:flutter/material.dart';

import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../utils/occurrence_expander.dart';
import '../utils/recurrence_summary.dart';
import 'activity_form_screen.dart';

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({
    super.key,
    required this.repository,
    this.embedded = false,
    this.onChanged,
  });

  final ActivityRepository repository;

  /// When embedded in [HomeScreen], render body only (shell owns chrome).
  final bool embedded;

  /// Called after a successful create/update so siblings can refresh.
  final VoidCallback? onChanged;

  @override
  State<CalendarScreen> createState() => CalendarScreenState();
}

class CalendarScreenState extends State<CalendarScreen> {
  late Future<List<Activity>> _activitiesFuture;
  late DateTime _selectedDate;

  @override
  void initState() {
    super.initState();
    _selectedDate = _dateOnly(DateTime.now());
    reload();
  }

  DateTime get selectedDate => _selectedDate;

  DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  void reload() {
    setState(() {
      _activitiesFuture = widget.repository.fetchActivities();
    });
  }

  void _shiftDay(int delta) {
    setState(() {
      _selectedDate = _selectedDate.add(Duration(days: delta));
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() => _selectedDate = _dateOnly(picked));
  }

  Future<void> openCreateForSelectedDay() =>
      _openForm(initialDate: _selectedDate);

  Future<void> _openForm({Activity? activity, DateTime? initialDate}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ActivityFormScreen(
          repository: widget.repository,
          activity: activity,
          initialDate: initialDate,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  String _displayDate(DateTime date) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final weekday = weekdays[date.weekday - 1];
    return '$weekday, ${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  Widget _buildBody() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
          child: Row(
            children: [
              IconButton(
                tooltip: 'Previous day',
                onPressed: () => _shiftDay(-1),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: TextButton(
                  onPressed: _pickDate,
                  child: Text(
                    _displayDate(_selectedDate),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Next day',
                onPressed: () => _shiftDay(1),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: FutureBuilder<List<Activity>>(
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
              final occurrences = expandOccurrences(
                activities: activities,
                from: _selectedDate,
                to: _selectedDate,
              );

              if (occurrences.isEmpty) {
                return Center(
                  child: Text(
                    'Nothing scheduled for this day.\nTap + to add one.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
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
                  itemCount: occurrences.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final occurrence = occurrences[index];
                    final activity = occurrence.activity;
                    return ListTile(
                      title: Text(activity.title),
                      subtitle: Text(
                        '${activity.startTime} – ${activity.endTime}'
                        '${activity.isRecurring ? ' · ${formatRecurrenceSummary(activity.recurrencePattern)}' : ''}',
                      ),
                      trailing: activity.isRecurring
                          ? const Chip(
                              label: Text('Recurring'),
                              visualDensity: VisualDensity.compact,
                            )
                          : null,
                      onTap: () => _openForm(activity: activity),
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

  @override
  Widget build(BuildContext context) {
    final body = _buildBody();
    if (widget.embedded) return body;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendar'),
      ),
      body: body,
      floatingActionButton: FloatingActionButton(
        onPressed: openCreateForSelectedDay,
        tooltip: 'Add activity for this day',
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

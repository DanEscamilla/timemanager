import '../models/activity.dart';

const _weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Short human-readable schedule label for list/calendar rows.
String formatActivitySchedule(Activity activity) {
  if (!activity.isRecurring) {
    final date = activity.date;
    if (date == null) return '${activity.startTime} – ${activity.endTime}';
    return '$date · ${activity.startTime} – ${activity.endTime}';
  }

  final summary = formatRecurrenceSummary(activity.recurrencePattern);
  return '$summary · ${activity.startTime} – ${activity.endTime}';
}

String formatRecurrenceSummary(RecurrencePattern? pattern) {
  if (pattern == null) return 'Recurring';

  final config = pattern.config;
  switch (pattern.recurrenceType) {
    case RecurrenceType.weekly:
      final days = config.daysOfWeek ?? const <int>[];
      if (days.isEmpty) return 'Weekly';
      final labels = days.map((d) => _weekdayLabels[d.clamp(0, 6)]).join(', ');
      return 'Weekly · $labels';
    case RecurrenceType.monthly:
      final parts = <String>[];
      final days = config.daysOfMonth ?? const <int>[];
      if (days.isNotEmpty) {
        parts.add(days.join(', '));
      }
      if (config.isLastDayOfMonth == true) {
        parts.add('last day');
      }
      if (parts.isEmpty) return 'Monthly';
      return 'Monthly · ${parts.join(', ')}';
    case RecurrenceType.everyXDays:
      final interval = config.intervalDays ?? 1;
      return interval == 1 ? 'Every day' : 'Every $interval days';
  }
}

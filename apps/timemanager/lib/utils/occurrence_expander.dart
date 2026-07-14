import '../models/activity.dart';
import 'date_only.dart';

/// Expands activities into concrete dated occurrences within an inclusive range.
List<ActivityOccurrence> expandOccurrences({
  required List<Activity> activities,
  required DateTime from,
  required DateTime to,
}) {
  final rangeStart = _dateOnly(from);
  final rangeEnd = _dateOnly(to);
  if (rangeEnd.isBefore(rangeStart)) return const [];

  final results = <ActivityOccurrence>[];

  for (final activity in activities) {
    if (!activity.isRecurring) {
      final dateStr = activity.date;
      if (dateStr == null) continue;
      final date = parseDateOnly(dateStr);
      if (_isInRange(date, rangeStart, rangeEnd)) {
        results.add(ActivityOccurrence(activity: activity, date: date));
      }
      continue;
    }

    final pattern = activity.recurrencePattern;
    if (pattern == null) continue;

    final config = pattern.config;
    final start = parseDateOnly(config.startDate);
    final end = config.endDate != null ? parseDateOnly(config.endDate!) : null;

    final windowStart =
        start.isAfter(rangeStart) ? start : rangeStart;
    var windowEnd = rangeEnd;
    if (end != null && end.isBefore(windowEnd)) {
      windowEnd = end;
    }
    if (windowEnd.isBefore(windowStart)) continue;

    switch (pattern.recurrenceType) {
      case RecurrenceType.weekly:
        results.addAll(
          _expandWeekly(
            activity: activity,
            daysOfWeek: config.daysOfWeek ?? const [],
            from: windowStart,
            to: windowEnd,
          ),
        );
      case RecurrenceType.monthly:
        results.addAll(
          _expandMonthly(
            activity: activity,
            daysOfMonth: config.daysOfMonth ?? const [],
            isLastDayOfMonth: config.isLastDayOfMonth == true,
            from: windowStart,
            to: windowEnd,
          ),
        );
      case RecurrenceType.everyXDays:
        results.addAll(
          _expandEveryXDays(
            activity: activity,
            start: start,
            intervalDays: config.intervalDays ?? 1,
            from: windowStart,
            to: windowEnd,
          ),
        );
    }
  }

  results.sort((a, b) {
    final byDate = a.date.compareTo(b.date);
    if (byDate != 0) return byDate;
    return a.activity.startTime.compareTo(b.activity.startTime);
  });

  return results;
}

Iterable<ActivityOccurrence> _expandWeekly({
  required Activity activity,
  required List<int> daysOfWeek,
  required DateTime from,
  required DateTime to,
}) sync* {
  if (daysOfWeek.isEmpty) return;
  final wanted = daysOfWeek.toSet();
  for (var day = from; !day.isAfter(to); day = day.add(const Duration(days: 1))) {
    // Dart: Monday=1 … Sunday=7. API: Sunday=0 … Saturday=6.
    final apiWeekday = day.weekday % 7;
    if (wanted.contains(apiWeekday)) {
      yield ActivityOccurrence(activity: activity, date: day);
    }
  }
}

Iterable<ActivityOccurrence> _expandMonthly({
  required Activity activity,
  required List<int> daysOfMonth,
  required bool isLastDayOfMonth,
  required DateTime from,
  required DateTime to,
}) sync* {
  if (daysOfMonth.isEmpty && !isLastDayOfMonth) return;
  final wantedDays = daysOfMonth.toSet();

  for (var day = from; !day.isAfter(to); day = day.add(const Duration(days: 1))) {
    final matchesDay = wantedDays.contains(day.day);
    final matchesLast =
        isLastDayOfMonth && day.day == _lastDayOfMonth(day).day;
    if (matchesDay || matchesLast) {
      yield ActivityOccurrence(activity: activity, date: day);
    }
  }
}

Iterable<ActivityOccurrence> _expandEveryXDays({
  required Activity activity,
  required DateTime start,
  required int intervalDays,
  required DateTime from,
  required DateTime to,
}) sync* {
  if (intervalDays < 1) return;

  // Walk forward from start by interval until we reach/pass [from].
  var cursor = start;
  if (cursor.isBefore(from)) {
    final daysBefore = from.difference(cursor).inDays;
    final steps = (daysBefore / intervalDays).ceil();
    cursor = cursor.add(Duration(days: steps * intervalDays));
  }

  for (; !cursor.isAfter(to); cursor = cursor.add(Duration(days: intervalDays))) {
    if (!cursor.isBefore(from)) {
      yield ActivityOccurrence(activity: activity, date: cursor);
    }
  }
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

bool _isInRange(DateTime date, DateTime from, DateTime to) =>
    !date.isBefore(from) && !date.isAfter(to);

DateTime _lastDayOfMonth(DateTime day) =>
    DateTime(day.year, day.month + 1, 0);

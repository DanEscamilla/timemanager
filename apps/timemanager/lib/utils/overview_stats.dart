import '../models/activity.dart';
import 'occurrence_expander.dart';

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

/// Client-side overview metrics derived from loaded activities.
class OverviewStats {
  const OverviewStats({
    required this.todayCount,
    required this.weekCount,
    required this.recurringCount,
    required this.todayOccurrences,
    required this.upcomingOccurrences,
  });

  final int todayCount;
  final int weekCount;
  final int recurringCount;
  final List<ActivityOccurrence> todayOccurrences;
  final List<ActivityOccurrence> upcomingOccurrences;
}

/// Builds [OverviewStats] for [now] from [activities] (no network).
OverviewStats buildOverviewStats(
  List<Activity> activities, {
  DateTime? now,
  int upcomingLimit = 5,
}) {
  final today = _dateOnly(now ?? DateTime.now());
  final weekStart = today.subtract(Duration(days: today.weekday - 1));
  final weekEnd = weekStart.add(const Duration(days: 6));
  final upcomingEnd = today.add(const Duration(days: 14));

  final todayOccurrences = expandOccurrences(
    activities: activities,
    from: today,
    to: today,
  )..sort((a, b) => a.activity.startTime.compareTo(b.activity.startTime));

  final weekOccurrences = expandOccurrences(
    activities: activities,
    from: weekStart,
    to: weekEnd,
  );

  final upcoming = expandOccurrences(
    activities: activities,
    from: today.add(const Duration(days: 1)),
    to: upcomingEnd,
  )..sort((a, b) {
      final byDate = a.date.compareTo(b.date);
      if (byDate != 0) return byDate;
      return a.activity.startTime.compareTo(b.activity.startTime);
    });

  final recurringCount = activities.where((a) => a.isRecurring).length;

  return OverviewStats(
    todayCount: todayOccurrences.length,
    weekCount: weekOccurrences.length,
    recurringCount: recurringCount,
    todayOccurrences: todayOccurrences,
    upcomingOccurrences: upcoming.take(upcomingLimit).toList(),
  );
}

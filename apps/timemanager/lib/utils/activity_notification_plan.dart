import '../models/activity.dart';
import 'calendar_event_mapper.dart';
import 'occurrence_expander.dart';

/// How far ahead to expand recurring occurrences for local scheduling.
const int kNotificationScheduleDays = 30;

/// A single pending local reminder derived from an activity occurrence.
class PlannedNotification {
  const PlannedNotification({
    required this.id,
    required this.activityId,
    required this.activityTitle,
    required this.occurrenceDate,
    required this.offsetMinutes,
    required this.fireAt,
  });

  /// Stable int id for [flutter_local_notifications] (31-bit positive).
  final int id;
  final int activityId;
  final String activityTitle;
  final DateTime occurrenceDate;
  final int offsetMinutes;
  final DateTime fireAt;
}

/// Builds the set of future local notifications for [activities].
///
/// Expands occurrences in `[now.date, now.date + scheduleDays]`, then for each
/// occurrence × offset computes `fireAt = start - offset`, skipping past times.
List<PlannedNotification> planActivityNotifications({
  required List<Activity> activities,
  required DateTime now,
  int scheduleDays = kNotificationScheduleDays,
}) {
  final from = _dateOnly(now);
  final to = from.add(Duration(days: scheduleDays));
  final occurrences = expandOccurrences(
    activities: activities,
    from: from,
    to: to,
  );

  final planned = <PlannedNotification>[];
  for (final occurrence in occurrences) {
    final activity = occurrence.activity;
    if (activity.notificationOffsets.isEmpty) continue;

    final startAt = combineDateAndTime(occurrence.date, activity.startTime);
    for (final offset in activity.notificationOffsets) {
      final fireAt = startAt.subtract(Duration(minutes: offset));
      if (!fireAt.isAfter(now)) continue;

      planned.add(
        PlannedNotification(
          id: notificationIdFor(
            activityId: activity.id,
            occurrenceDate: occurrence.date,
            offsetMinutes: offset,
          ),
          activityId: activity.id,
          activityTitle: activity.title,
          occurrenceDate: occurrence.date,
          offsetMinutes: offset,
          fireAt: fireAt,
        ),
      );
    }
  }

  planned.sort((a, b) => a.fireAt.compareTo(b.fireAt));
  return planned;
}

/// Stable positive 31-bit id from activity + occurrence date + offset.
int notificationIdFor({
  required int activityId,
  required DateTime occurrenceDate,
  required int offsetMinutes,
}) {
  final dateKey =
      occurrenceDate.year * 10000 +
      occurrenceDate.month * 100 +
      occurrenceDate.day;
  // Mix fields; keep in signed 31-bit range used by the plugin.
  var hash = 17;
  hash = 37 * hash + activityId;
  hash = 37 * hash + dateKey;
  hash = 37 * hash + offsetMinutes;
  return hash.abs() & 0x7fffffff;
}

/// Formats the notification body for a given offset (English fallback for
/// pure helpers; UI/scheduler should prefer AppLocalizations).
String notificationBodyForOffset(int offsetMinutes) {
  if (offsetMinutes <= 0) return 'Starting now';
  if (offsetMinutes < 60) return 'Starts in $offsetMinutes min';
  if (offsetMinutes % 1440 == 0) {
    final days = offsetMinutes ~/ 1440;
    return 'Starts in $days d';
  }
  if (offsetMinutes % 60 == 0) {
    final hours = offsetMinutes ~/ 60;
    return 'Starts in $hours h';
  }
  return 'Starts in $offsetMinutes min';
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

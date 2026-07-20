import 'package:local_notifications/local_notifications.dart';

import '../models/activity.dart';
import '../utils/activity_notification_plan.dart';

const kActivityNotificationConfig = LocalNotificationConfig(
  androidChannelId: 'activity_reminders',
  androidChannelName: 'Activity reminders',
  androidChannelDescription: 'Reminders for upcoming activities',
  cacheKey: 'activity_notification_plan_v1',
);

/// Schedules local activity reminders from synced activity data.
///
/// Thin wrapper over [LocalNotificationService] that plans activity
/// occurrences and maps them to generic scheduled notifications.
class ActivityNotificationScheduler {
  ActivityNotificationScheduler._();

  static final ActivityNotificationScheduler instance =
      ActivityNotificationScheduler._();

  final LocalNotificationService _service = LocalNotificationService.instance;

  /// Initializes timezone data and the platform notification plugin.
  Future<void> ensureInitialized() =>
      _service.ensureInitialized(kActivityNotificationConfig);

  /// Requests notification permission when the user enables reminders.
  Future<bool> requestPermission() => _service.requestPermission();

  /// Cancels all pending reminders and schedules [activities] for the next
  /// [kNotificationScheduleDays] days.
  Future<void> sync(List<Activity> activities, {DateTime? now}) async {
    await ensureInitialized();
    final planned = planActivityNotifications(
      activities: activities,
      now: now ?? DateTime.now(),
    );
    await _service.syncScheduled([
      for (final item in planned)
        ScheduledNotification(
          id: item.id,
          title: item.activityTitle,
          body: notificationBodyForOffset(item.offsetMinutes),
          fireAt: item.fireAt,
        ),
    ]);
  }

  /// Clears all scheduled / in-session reminders.
  Future<void> cancelAll() => _service.cancelAll();
}

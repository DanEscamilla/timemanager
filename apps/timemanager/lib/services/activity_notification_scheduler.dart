import '../models/activity.dart';
import '../utils/activity_notification_plan.dart';
import 'activity_notification_scheduler_stub.dart'
    if (dart.library.html) 'activity_notification_scheduler_web.dart'
    if (dart.library.io) 'activity_notification_scheduler_io.dart'
    as impl;

/// Schedules local activity reminders from synced activity data.
///
/// Native platforms use OS local notifications; web fires in-session while
/// the tab is open.
class ActivityNotificationScheduler {
  ActivityNotificationScheduler._();

  static final ActivityNotificationScheduler instance =
      ActivityNotificationScheduler._();

  bool _initialized = false;

  /// Initializes timezone data and the platform notification plugin.
  Future<void> ensureInitialized() async {
    if (_initialized) return;
    try {
      await impl.initializeNotifications();
      _initialized = true;
    } catch (_) {
      // Plugins may be unavailable in tests / unsupported platforms.
      _initialized = true;
    }
  }

  /// Requests notification permission when the user enables reminders.
  Future<bool> requestPermission() => impl.requestNotificationPermission();

  /// Cancels all pending reminders and schedules [activities] for the next
  /// [kNotificationScheduleDays] days.
  Future<void> sync(List<Activity> activities, {DateTime? now}) async {
    await ensureInitialized();
    final planned = planActivityNotifications(
      activities: activities,
      now: now ?? DateTime.now(),
    );
    try {
      await impl.syncPlannedNotifications(planned);
    } catch (_) {
      // Best-effort scheduling.
    }
  }

  /// Clears all scheduled / in-session reminders.
  Future<void> cancelAll() async {
    await ensureInitialized();
    try {
      await impl.cancelAllNotifications();
    } catch (_) {
      // Best-effort.
    }
  }
}

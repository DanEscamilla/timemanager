import 'local_notification_config.dart';
import 'models.dart';
import 'platform/local_notifications_platform_stub.dart'
    if (dart.library.html) 'platform/local_notifications_platform_web.dart'
    if (dart.library.io) 'platform/local_notifications_platform_io.dart'
    as impl;

/// Schedules and shows local notifications across product apps.
///
/// Native platforms use OS local notifications; web fires in-session while
/// the tab is open.
class LocalNotificationService {
  LocalNotificationService._();

  static final LocalNotificationService instance = LocalNotificationService._();

  LocalNotificationConfig? _config;
  bool _initialized = false;

  LocalNotificationConfig get _requireConfig {
    final config = _config;
    if (config == null) {
      throw StateError(
        'LocalNotificationService.ensureInitialized must be called first',
      );
    }
    return config;
  }

  /// Initializes timezone data and the platform notification plugin.
  Future<void> ensureInitialized(LocalNotificationConfig config) async {
    _config = config;
    if (_initialized) return;
    try {
      await impl.initializeNotifications(config);
      _initialized = true;
    } catch (_) {
      // Plugins may be unavailable in tests / unsupported platforms.
      _initialized = true;
    }
  }

  /// Requests notification permission when the user enables reminders.
  Future<bool> requestPermission() => impl.requestNotificationPermission();

  /// Cancels all pending reminders and schedules [items].
  Future<void> syncScheduled(List<ScheduledNotification> items) async {
    await ensureInitialized(_requireConfig);
    try {
      await impl.syncScheduledNotifications(items, _requireConfig);
    } catch (_) {
      // Best-effort scheduling.
    }
  }

  /// Shows a notification immediately (threshold alerts, etc.).
  Future<void> showNow(ImmediateNotification item) async {
    await ensureInitialized(_requireConfig);
    try {
      await impl.showImmediateNotification(item, _requireConfig);
    } catch (_) {
      // Best-effort delivery.
    }
  }

  /// Clears all scheduled / in-session reminders.
  Future<void> cancelAll() async {
    await ensureInitialized(_requireConfig);
    try {
      await impl.cancelAllNotifications(_requireConfig);
    } catch (_) {
      // Best-effort.
    }
  }

  /// Re-schedules from the last cached plan (used after device reboot).
  Future<void> rescheduleFromCache() async {
    await ensureInitialized(_requireConfig);
    try {
      await impl.rescheduleFromCache(_requireConfig);
    } catch (_) {
      // Best-effort.
    }
  }
}

import '../local_notification_config.dart';
import '../models.dart';

Future<void> initializeNotifications(LocalNotificationConfig config) async {}

Future<bool> requestNotificationPermission() async => false;

Future<void> syncScheduledNotifications(
  List<ScheduledNotification> items,
  LocalNotificationConfig config,
) async {}

Future<void> showImmediateNotification(
  ImmediateNotification item,
  LocalNotificationConfig config,
) async {}

Future<void> cancelAllNotifications(LocalNotificationConfig config) async {}

Future<void> rescheduleFromCache(LocalNotificationConfig config) async {}

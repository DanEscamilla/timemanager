import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../local_notification_config.dart';
import '../models.dart';

final FlutterLocalNotificationsPlugin _plugin =
    FlutterLocalNotificationsPlugin();

Future<void> initializeNotifications(LocalNotificationConfig config) async {
  tz_data.initializeTimeZones();
  try {
    final name = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(name));
  } catch (_) {
    tz.setLocalLocation(tz.getLocation('UTC'));
  }

  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  const darwin = DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  const settings = InitializationSettings(
    android: android,
    iOS: darwin,
    macOS: darwin,
  );

  await _plugin.initialize(settings);

  if (Platform.isAndroid) {
    await _plugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
          AndroidNotificationChannel(
            config.androidChannelId,
            config.androidChannelName,
            description: config.androidChannelDescription,
            importance: Importance.high,
          ),
        );
  }
}

Future<bool> requestNotificationPermission() async {
  if (Platform.isAndroid) {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    final granted = await android?.requestNotificationsPermission();
    return granted ?? false;
  }
  if (Platform.isIOS) {
    final ios = _plugin.resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin>();
    final granted = await ios?.requestPermissions(
      alert: true,
      badge: true,
      sound: true,
    );
    return granted ?? false;
  }
  if (Platform.isMacOS) {
    final mac = _plugin.resolvePlatformSpecificImplementation<
        MacOSFlutterLocalNotificationsPlugin>();
    final granted = await mac?.requestPermissions(
      alert: true,
      badge: true,
      sound: true,
    );
    return granted ?? false;
  }
  return true;
}

Future<void> syncScheduledNotifications(
  List<ScheduledNotification> items,
  LocalNotificationConfig config,
) async {
  await _plugin.cancelAll();
  await _cachePlan(items, config);

  if (items.isNotEmpty) {
    await requestNotificationPermission();
  }

  final androidDetails = AndroidNotificationDetails(
    config.androidChannelId,
    config.androidChannelName,
    channelDescription: config.androidChannelDescription,
    importance: Importance.high,
    priority: Priority.high,
  );
  const darwinDetails = DarwinNotificationDetails();
  final details = NotificationDetails(
    android: androidDetails,
    iOS: darwinDetails,
    macOS: darwinDetails,
  );

  for (final item in items) {
    final scheduled = tz.TZDateTime.from(item.fireAt, tz.local);
    if (!scheduled.isAfter(tz.TZDateTime.now(tz.local))) continue;

    try {
      await _plugin.zonedSchedule(
        item.id,
        item.title,
        item.body,
        scheduled,
        details,
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      );
    } catch (e) {
      // Exact alarms may be denied on some Android builds; fall back.
      debugPrint('Failed to schedule notification ${item.id}: $e');
      try {
        await _plugin.zonedSchedule(
          item.id,
          item.title,
          item.body,
          scheduled,
          details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        );
      } catch (e2) {
        debugPrint('Fallback schedule also failed for ${item.id}: $e2');
      }
    }
  }
}

Future<void> showImmediateNotification(
  ImmediateNotification item,
  LocalNotificationConfig config,
) async {
  await requestNotificationPermission();

  final androidDetails = AndroidNotificationDetails(
    config.androidChannelId,
    config.androidChannelName,
    channelDescription: config.androidChannelDescription,
    importance: Importance.high,
    priority: Priority.high,
  );
  const darwinDetails = DarwinNotificationDetails();
  final details = NotificationDetails(
    android: androidDetails,
    iOS: darwinDetails,
    macOS: darwinDetails,
  );

  await _plugin.show(item.id, item.title, item.body, details);
}

Future<void> cancelAllNotifications(LocalNotificationConfig config) async {
  await _plugin.cancelAll();
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove(config.cacheKey);
}

Future<void> _cachePlan(
  List<ScheduledNotification> items,
  LocalNotificationConfig config,
) async {
  final prefs = await SharedPreferences.getInstance();
  final encoded = jsonEncode([for (final item in items) item.toJson()]);
  await prefs.setString(config.cacheKey, encoded);
}

/// Re-schedules from the last cached plan (used after device reboot).
Future<void> rescheduleFromCache(LocalNotificationConfig config) async {
  await initializeNotifications(config);
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(config.cacheKey);
  if (raw == null || raw.isEmpty) return;

  final list = jsonDecode(raw) as List<dynamic>;
  final now = DateTime.now();
  final planned = <ScheduledNotification>[];
  for (final entry in list) {
    final map = entry as Map<String, dynamic>;
    final item = ScheduledNotification.fromJson(map);
    if (!item.fireAt.isAfter(now)) continue;
    planned.add(item);
  }
  await syncScheduledNotifications(planned, config);
}

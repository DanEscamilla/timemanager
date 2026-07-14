import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../utils/activity_notification_plan.dart';

const _channelId = 'activity_reminders';
const _channelName = 'Activity reminders';
const _cacheKey = 'activity_notification_plan_v1';

final FlutterLocalNotificationsPlugin _plugin =
    FlutterLocalNotificationsPlugin();

Future<void> initializeNotifications() async {
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
          const AndroidNotificationChannel(
            _channelId,
            _channelName,
            description: 'Reminders for upcoming activities',
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

Future<void> syncPlannedNotifications(List<PlannedNotification> planned) async {
  await _plugin.cancelAll();
  await _cachePlan(planned);

  if (planned.isNotEmpty) {
    await requestNotificationPermission();
  }

  const androidDetails = AndroidNotificationDetails(
    _channelId,
    _channelName,
    channelDescription: 'Reminders for upcoming activities',
    importance: Importance.high,
    priority: Priority.high,
  );
  const darwinDetails = DarwinNotificationDetails();
  const details = NotificationDetails(
    android: androidDetails,
    iOS: darwinDetails,
    macOS: darwinDetails,
  );

  for (final item in planned) {
    final scheduled = tz.TZDateTime.from(item.fireAt, tz.local);
    if (!scheduled.isAfter(tz.TZDateTime.now(tz.local))) continue;

    try {
      await _plugin.zonedSchedule(
        item.id,
        item.activityTitle,
        notificationBodyForOffset(item.offsetMinutes),
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
          item.activityTitle,
          notificationBodyForOffset(item.offsetMinutes),
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

Future<void> cancelAllNotifications() async {
  await _plugin.cancelAll();
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove(_cacheKey);
}

Future<void> _cachePlan(List<PlannedNotification> planned) async {
  final prefs = await SharedPreferences.getInstance();
  final encoded = jsonEncode([
    for (final item in planned)
      {
        'id': item.id,
        'activityId': item.activityId,
        'activityTitle': item.activityTitle,
        'occurrenceDate': item.occurrenceDate.toIso8601String(),
        'offsetMinutes': item.offsetMinutes,
        'fireAt': item.fireAt.toIso8601String(),
      },
  ]);
  await prefs.setString(_cacheKey, encoded);
}

/// Re-schedules from the last cached plan (used after device reboot).
Future<void> rescheduleFromCache() async {
  await initializeNotifications();
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_cacheKey);
  if (raw == null || raw.isEmpty) return;

  final list = jsonDecode(raw) as List<dynamic>;
  final now = DateTime.now();
  final planned = <PlannedNotification>[];
  for (final entry in list) {
    final map = entry as Map<String, dynamic>;
    final fireAt = DateTime.parse(map['fireAt'] as String);
    if (!fireAt.isAfter(now)) continue;
    planned.add(
      PlannedNotification(
        id: map['id'] as int,
        activityId: map['activityId'] as int,
        activityTitle: map['activityTitle'] as String,
        occurrenceDate: DateTime.parse(map['occurrenceDate'] as String),
        offsetMinutes: map['offsetMinutes'] as int,
        fireAt: fireAt,
      ),
    );
  }
  await syncPlannedNotifications(planned);
}

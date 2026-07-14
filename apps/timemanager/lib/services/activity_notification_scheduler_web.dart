import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import '../utils/activity_notification_plan.dart';

Timer? _pollTimer;
List<PlannedNotification> _pending = const [];
final Set<int> _firedIds = {};

Future<void> initializeNotifications() async {
  // No OS plugin on web; polling starts on first sync.
}

Future<bool> requestNotificationPermission() async {
  if (web.Notification.permission == 'granted') return true;
  if (web.Notification.permission == 'denied') return false;
  final result = await web.Notification.requestPermission().toDart;
  return result.toDart == 'granted';
}

Future<void> syncPlannedNotifications(List<PlannedNotification> planned) async {
  _pending = List.unmodifiable(planned);
  _firedIds.removeWhere((id) => !_pending.any((p) => p.id == id));
  _pollTimer?.cancel();
  if (_pending.isEmpty) {
    _pollTimer = null;
    return;
  }
  await requestNotificationPermission();
  _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) => _tick());
  _tick();
}

Future<void> cancelAllNotifications() async {
  _pollTimer?.cancel();
  _pollTimer = null;
  _pending = const [];
  _firedIds.clear();
}

void _tick() {
  if (web.Notification.permission != 'granted') return;

  final now = DateTime.now();
  for (final item in _pending) {
    if (_firedIds.contains(item.id)) continue;
    // Fire when we've reached/passed fireAt, within a short grace window so
    // a slow poll still delivers (avoid replaying hours-late reminders).
    if (now.isBefore(item.fireAt)) continue;
    if (now.difference(item.fireAt) > const Duration(minutes: 2)) {
      _firedIds.add(item.id);
      continue;
    }
    _firedIds.add(item.id);
    web.Notification(
      item.activityTitle,
      web.NotificationOptions(
        body: notificationBodyForOffset(item.offsetMinutes),
      ),
    );
  }
}

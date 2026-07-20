import 'package:flutter_test/flutter_test.dart';
import 'package:local_notifications/local_notifications.dart';

void main() {
  test('ScheduledNotification round-trips through JSON', () {
    final original = ScheduledNotification(
      id: 42,
      title: 'Title',
      body: 'Body',
      fireAt: DateTime.utc(2026, 7, 20, 12),
    );
    final restored = ScheduledNotification.fromJson(original.toJson());
    expect(restored.id, original.id);
    expect(restored.title, original.title);
    expect(restored.body, original.body);
    expect(restored.fireAt, original.fireAt);
  });
}

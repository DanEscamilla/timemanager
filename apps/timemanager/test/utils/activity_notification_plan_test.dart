import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/utils/activity_notification_plan.dart';

Activity _activity({
  required int id,
  required String startTime,
  required bool isRecurring,
  String? date,
  List<int> notificationOffsets = const [],
  RecurrencePattern? recurrencePattern,
}) {
  final now = DateTime(2026, 7, 14);
  return Activity(
    id: id,
    userId: 1,
    title: 'Activity $id',
    startTime: startTime,
    endTime: '10:00',
    isRecurring: isRecurring,
    date: date,
    notificationOffsets: notificationOffsets,
    recurrencePattern: recurrencePattern,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  group('planActivityNotifications', () {
    test('plans one-off with multiple offsets', () {
      final activity = _activity(
        id: 1,
        startTime: '09:00',
        isRecurring: false,
        date: '2026-07-15',
        notificationOffsets: [0, 15],
      );
      final now = DateTime(2026, 7, 14, 12, 0);

      final planned = planActivityNotifications(
        activities: [activity],
        now: now,
      );

      expect(planned, hasLength(2));
      expect(planned.map((p) => p.offsetMinutes).toList(), [15, 0]);
      expect(planned[0].fireAt, DateTime(2026, 7, 15, 8, 45));
      expect(planned[1].fireAt, DateTime(2026, 7, 15, 9, 0));
      expect(planned[0].activityTitle, 'Activity 1');
    });

    test('skips past fire times', () {
      final activity = _activity(
        id: 2,
        startTime: '09:00',
        isRecurring: false,
        date: '2026-07-14',
        notificationOffsets: [0, 60],
      );
      // 08:30 — 60m reminder (08:00) is past; at-start (09:00) is future.
      final now = DateTime(2026, 7, 14, 8, 30);

      final planned = planActivityNotifications(
        activities: [activity],
        now: now,
      );

      expect(planned, hasLength(1));
      expect(planned.single.offsetMinutes, 0);
      expect(planned.single.fireAt, DateTime(2026, 7, 14, 9, 0));
    });

    test('skips activities with empty offsets', () {
      final activity = _activity(
        id: 3,
        startTime: '09:00',
        isRecurring: false,
        date: '2026-07-15',
      );

      final planned = planActivityNotifications(
        activities: [activity],
        now: DateTime(2026, 7, 14),
      );

      expect(planned, isEmpty);
    });

    test('expands recurring weekly occurrences', () {
      final activity = _activity(
        id: 4,
        startTime: '09:00',
        isRecurring: true,
        notificationOffsets: [0],
        recurrencePattern: RecurrencePattern(
          recurrenceType: RecurrenceType.weekly,
          config: const RecurrenceConfig(
            startDate: '2026-07-01',
            daysOfWeek: [3], // Wednesday (API: Sun=0)
          ),
        ),
      );
      // Tuesday Jul 14 2026; next Wednesdays: 15, 22, 29 + into August within 30d
      final now = DateTime(2026, 7, 14, 8, 0);

      final planned = planActivityNotifications(
        activities: [activity],
        now: now,
        scheduleDays: 14,
      );

      expect(planned.length, greaterThanOrEqualTo(2));
      expect(
        planned.every((p) => p.occurrenceDate.weekday == DateTime.wednesday),
        isTrue,
      );
      expect(planned.first.fireAt, DateTime(2026, 7, 15, 9, 0));
    });

    test('notification ids are stable for same inputs', () {
      final date = DateTime(2026, 7, 15);
      final a = notificationIdFor(
        activityId: 10,
        occurrenceDate: date,
        offsetMinutes: 15,
      );
      final b = notificationIdFor(
        activityId: 10,
        occurrenceDate: date,
        offsetMinutes: 15,
      );
      final c = notificationIdFor(
        activityId: 10,
        occurrenceDate: date,
        offsetMinutes: 0,
      );
      expect(a, b);
      expect(a, isNot(c));
      expect(a, greaterThanOrEqualTo(0));
      expect(a, lessThanOrEqualTo(0x7fffffff));
    });
  });

  group('notificationBodyForOffset', () {
    test('formats common offsets', () {
      expect(notificationBodyForOffset(0), 'Starting now');
      expect(notificationBodyForOffset(15), 'Starts in 15 min');
      expect(notificationBodyForOffset(60), 'Starts in 1 h');
      expect(notificationBodyForOffset(1440), 'Starts in 1 d');
    });
  });
}

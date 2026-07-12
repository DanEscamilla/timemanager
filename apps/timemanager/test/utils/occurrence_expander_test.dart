import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/utils/occurrence_expander.dart';

Activity _activity({
  required int id,
  required bool isRecurring,
  String? date,
  RecurrencePattern? recurrencePattern,
  String startTime = '09:00',
}) {
  final now = DateTime(2026, 7, 1);
  return Activity(
    id: id,
    userId: 1,
    title: 'Activity $id',
    startTime: startTime,
    endTime: '10:00',
    isRecurring: isRecurring,
    date: date,
    recurrencePattern: recurrencePattern,
    createdAt: now,
    updatedAt: now,
  );
}

RecurrencePattern _pattern({
  required RecurrenceType type,
  required RecurrenceConfig config,
}) {
  return RecurrencePattern(recurrenceType: type, config: config);
}

void main() {
  group('expandOccurrences', () {
    test('returns empty when range is inverted', () {
      final activities = [
        _activity(id: 1, isRecurring: false, date: '2026-07-12'),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 15),
        to: DateTime(2026, 7, 10),
      );
      expect(result, isEmpty);
    });

    test('includes one-off activity whose date is in range', () {
      final activities = [
        _activity(id: 1, isRecurring: false, date: '2026-07-12'),
        _activity(id: 2, isRecurring: false, date: '2026-07-20'),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 10),
        to: DateTime(2026, 7, 15),
      );
      expect(result, hasLength(1));
      expect(result.single.activity.id, 1);
      expect(result.single.date, DateTime(2026, 7, 12));
    });

    test('skips one-off without a date', () {
      final activities = [
        _activity(id: 1, isRecurring: false),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 1),
        to: DateTime(2026, 7, 31),
      );
      expect(result, isEmpty);
    });

    test('expands weekly on selected weekdays within window', () {
      // 2026-07-12 is Sunday. Mon=13, Wed=15, Fri=17.
      final activities = [
        _activity(
          id: 1,
          isRecurring: true,
          recurrencePattern: _pattern(
            type: RecurrenceType.weekly,
            config: const RecurrenceConfig(
              startDate: '2026-07-12',
              daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
            ),
          ),
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 12),
        to: DateTime(2026, 7, 18),
      );
      expect(
        result.map((o) => o.date).toList(),
        [
          DateTime(2026, 7, 13),
          DateTime(2026, 7, 15),
          DateTime(2026, 7, 17),
        ],
      );
    });

    test('clips weekly occurrences with end_date', () {
      final activities = [
        _activity(
          id: 1,
          isRecurring: true,
          recurrencePattern: _pattern(
            type: RecurrenceType.weekly,
            config: const RecurrenceConfig(
              startDate: '2026-07-12',
              endDate: '2026-07-15',
              daysOfWeek: [1, 3, 5],
            ),
          ),
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 12),
        to: DateTime(2026, 7, 18),
      );
      expect(
        result.map((o) => o.date).toList(),
        [
          DateTime(2026, 7, 13),
          DateTime(2026, 7, 15),
        ],
      );
    });

    test('expands monthly days and last day of month', () {
      final activities = [
        _activity(
          id: 1,
          isRecurring: true,
          recurrencePattern: _pattern(
            type: RecurrenceType.monthly,
            config: const RecurrenceConfig(
              startDate: '2026-06-01',
              daysOfMonth: [1, 15],
              isLastDayOfMonth: true,
            ),
          ),
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 6, 1),
        to: DateTime(2026, 7, 31),
      );
      expect(
        result.map((o) => o.date).toList(),
        [
          DateTime(2026, 6, 1),
          DateTime(2026, 6, 15),
          DateTime(2026, 6, 30),
          DateTime(2026, 7, 1),
          DateTime(2026, 7, 15),
          DateTime(2026, 7, 31),
        ],
      );
    });

    test('expands every_x_days from start_date', () {
      final activities = [
        _activity(
          id: 1,
          isRecurring: true,
          recurrencePattern: _pattern(
            type: RecurrenceType.everyXDays,
            config: const RecurrenceConfig(
              startDate: '2026-07-10',
              intervalDays: 3,
            ),
          ),
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 10),
        to: DateTime(2026, 7, 20),
      );
      expect(
        result.map((o) => o.date).toList(),
        [
          DateTime(2026, 7, 10),
          DateTime(2026, 7, 13),
          DateTime(2026, 7, 16),
          DateTime(2026, 7, 19),
        ],
      );
    });

    test('every_x_days aligns when range starts mid-cycle', () {
      final activities = [
        _activity(
          id: 1,
          isRecurring: true,
          recurrencePattern: _pattern(
            type: RecurrenceType.everyXDays,
            config: const RecurrenceConfig(
              startDate: '2026-07-01',
              intervalDays: 5,
            ),
          ),
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 8),
        to: DateTime(2026, 7, 16),
      );
      expect(
        result.map((o) => o.date).toList(),
        [
          DateTime(2026, 7, 11),
          DateTime(2026, 7, 16),
        ],
      );
    });

    test('sorts by date then startTime', () {
      final activities = [
        _activity(
          id: 1,
          isRecurring: false,
          date: '2026-07-12',
          startTime: '14:00',
        ),
        _activity(
          id: 2,
          isRecurring: false,
          date: '2026-07-12',
          startTime: '09:00',
        ),
      ];
      final result = expandOccurrences(
        activities: activities,
        from: DateTime(2026, 7, 12),
        to: DateTime(2026, 7, 12),
      );
      expect(result.map((o) => o.activity.id).toList(), [2, 1]);
    });
  });
}

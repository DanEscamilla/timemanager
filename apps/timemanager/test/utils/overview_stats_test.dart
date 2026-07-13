import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/utils/overview_stats.dart';

Activity _activity({
  required int id,
  required String title,
  required bool recurring,
  String? date,
  RecurrencePattern? pattern,
  String start = '09:00',
  String end = '10:00',
}) {
  final now = DateTime(2026, 7, 12);
  return Activity(
    id: id,
    userId: 1,
    title: title,
    startTime: start,
    endTime: end,
    isRecurring: recurring,
    date: date,
    recurrencePattern: pattern,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  group('buildOverviewStats', () {
    test('counts today, week, and recurring from activities', () {
      final monday = DateTime(2026, 7, 13); // Monday
      final activities = [
        _activity(
          id: 1,
          title: 'One-off today',
          recurring: false,
          date: '2026-07-13',
        ),
        _activity(
          id: 2,
          title: 'Weekly',
          recurring: true,
          pattern: RecurrencePattern(
            recurrenceType: RecurrenceType.weekly,
            config: const RecurrenceConfig(
              startDate: '2026-07-01',
              daysOfWeek: [1], // Monday
            ),
          ),
        ),
        _activity(
          id: 3,
          title: 'Tomorrow',
          recurring: false,
          date: '2026-07-14',
        ),
      ];

      final stats = buildOverviewStats(activities, now: monday);

      expect(stats.todayCount, 2); // one-off + weekly
      expect(stats.weekCount, greaterThanOrEqualTo(2));
      expect(stats.recurringCount, 1);
      expect(stats.todayOccurrences, hasLength(2));
      expect(stats.upcomingOccurrences, isNotEmpty);
      expect(
        stats.upcomingOccurrences.first.activity.title,
        'Tomorrow',
      );
    });

    test('returns zeros for empty list', () {
      final stats = buildOverviewStats(const [], now: DateTime(2026, 7, 12));
      expect(stats.todayCount, 0);
      expect(stats.weekCount, 0);
      expect(stats.recurringCount, 0);
      expect(stats.todayOccurrences, isEmpty);
      expect(stats.upcomingOccurrences, isEmpty);
    });
  });
}

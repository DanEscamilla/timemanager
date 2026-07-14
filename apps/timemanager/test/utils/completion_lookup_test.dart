import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/goal.dart';
import 'package:timemanager/utils/completion_lookup.dart';

void main() {
  group('dateToIso', () {
    test('pads month and day', () {
      expect(dateToIso(DateTime(2026, 7, 3)), '2026-07-03');
    });
  });

  group('completionKey', () {
    test('joins activity id and occurrence date', () {
      expect(completionKey(12, '2026-07-13'), '12|2026-07-13');
    });
  });

  group('indexCompletions', () {
    test('indexes by activityId and occurrenceDate', () {
      final a = ActivityCompletion(
        id: 1,
        activityId: 10,
        userId: 1,
        occurrenceDate: '2026-07-13',
        completedAt: DateTime(2026, 7, 13, 9),
      );
      final b = ActivityCompletion(
        id: 2,
        activityId: 10,
        userId: 1,
        occurrenceDate: '2026-07-14',
        completedAt: DateTime(2026, 7, 14, 9),
      );

      final map = indexCompletions([a, b]);

      expect(map[completionKey(10, '2026-07-13')], a);
      expect(map[completionKey(10, '2026-07-14')], b);
      expect(map.containsKey(completionKey(10, '2026-07-15')), isFalse);
    });
  });
}

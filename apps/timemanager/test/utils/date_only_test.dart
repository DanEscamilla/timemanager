import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/utils/date_only.dart';

void main() {
  group('dateToIso', () {
    test('pads month and day', () {
      expect(dateToIso(DateTime(2026, 7, 3)), '2026-07-03');
    });
  });

  group('parseDateOnly', () {
    test('parses YYYY-MM-DD', () {
      expect(parseDateOnly('2026-07-13'), DateTime(2026, 7, 13));
    });

    test('parses ISO datetime without timezone shift', () {
      // UTC midnight must stay on the calendar day from the wire prefix.
      expect(
        parseDateOnly('2026-07-13T00:00:00.000Z'),
        DateTime(2026, 7, 13),
      );
    });
  });

  group('asDateOnlyString', () {
    test('returns null for null and blank', () {
      expect(asDateOnlyString(null), isNull);
      expect(asDateOnlyString(''), isNull);
      expect(asDateOnlyString('   '), isNull);
    });

    test('keeps YYYY-MM-DD and truncates ISO timestamps', () {
      expect(asDateOnlyString('2026-07-13'), '2026-07-13');
      expect(asDateOnlyString('2026-07-13T00:00:00.000Z'), '2026-07-13');
    });
  });
}

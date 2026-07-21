import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/utils/json_dates.dart';

void main() {
  test('parseJsonDate handles ISO strings', () {
    expect(
      parseJsonDate('2026-07-20T12:00:00.000Z'),
      DateTime.utc(2026, 7, 20, 12),
    );
  });

  test('parseJsonDate handles millis digit strings', () {
    expect(
      parseJsonDate('1784612431777'),
      DateTime.fromMillisecondsSinceEpoch(1784612431777, isUtc: true),
    );
  });

  test('parseJsonDate handles millis numbers', () {
    expect(
      parseJsonDate(1784612431777),
      DateTime.fromMillisecondsSinceEpoch(1784612431777, isUtc: true),
    );
  });

  test('parseJsonDateOrNull returns null for null', () {
    expect(parseJsonDateOrNull(null), isNull);
  });
}

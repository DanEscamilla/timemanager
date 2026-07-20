import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/utils/money.dart';

void main() {
  test('parseAmountToCents handles dollars and cents', () {
    expect(parseAmountToCents('12.50'), 1250);
    expect(parseAmountToCents('12'), 1200);
    expect(parseAmountToCents('12.5'), 1250);
    expect(parseAmountToCents('0.99'), 99);
    expect(parseAmountToCents(''), isNull);
    expect(parseAmountToCents('abc'), isNull);
    expect(parseAmountToCents('12.999'), isNull);
  });

  test('formatMoney and centsToInput round-trip display', () {
    expect(formatMoney(1250), 'USD 12.50');
    expect(centsToInput(1250), '12.50');
    expect(dateOnly(DateTime(2026, 7, 20)), '2026-07-20');
  });
}

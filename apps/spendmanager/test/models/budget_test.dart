import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/models/budget.dart';

void main() {
  test('Budget.fromJson accepts epoch-millis created_at strings from GraphQL', () {
    final budget = Budget.fromJson({
      'id': 1,
      'user_id': 2,
      'name': 'test budget',
      'category_id': null,
      'amount_cents': 100,
      'currency': 'USD',
      'interval_unit': 'month',
      'interval_count': 1,
      'anchor_date': '2026-07-20',
      'alert_percent': 80,
      'archived_at': null,
      'created_at': '1784612431777',
      'updated_at': '1784612431777',
    });

    expect(budget.id, 1);
    expect(budget.name, 'test budget');
    expect(budget.createdAt.toUtc(),
        DateTime.fromMillisecondsSinceEpoch(1784612431777, isUtc: true));
    expect(budget.updatedAt.toUtc(),
        DateTime.fromMillisecondsSinceEpoch(1784612431777, isUtc: true));
  });

  test('Budget.fromJson accepts ISO timestamps', () {
    final budget = Budget.fromJson({
      'id': 1,
      'user_id': 2,
      'name': 'iso',
      'category_id': null,
      'amount_cents': 100,
      'currency': 'USD',
      'interval_unit': 'month',
      'interval_count': 1,
      'anchor_date': '2026-07-20',
      'alert_percent': 80,
      'archived_at': null,
      'created_at': '2026-07-20T12:00:00.000Z',
      'updated_at': '2026-07-20T12:00:00.000Z',
    });

    expect(budget.createdAt.toUtc(), DateTime.utc(2026, 7, 20, 12));
  });
}

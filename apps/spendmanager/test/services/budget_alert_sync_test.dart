import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spendmanager/config/api_config.dart';
import 'package:spendmanager/models/budget.dart';
import 'package:spendmanager/services/budget_alert_sync.dart';
import 'package:spendmanager/services/budget_repository.dart';

class _FakeBudgetRepository extends BudgetRepository {
  _FakeBudgetRepository(this.statuses);

  final List<BudgetStatus> statuses;

  @override
  Future<List<BudgetStatus>> fetchStatuses({String? asOf}) async => statuses;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    ApiConfig.ensureConfigured();
    SharedPreferences.setMockInitialValues({});
  });

  test('preferServerPush skips local showNow and prefs write', () async {
    final sync = BudgetAlertSync(
      repository: _FakeBudgetRepository([
        const BudgetStatus(
          budgetId: 1,
          budgetName: 'Food',
          categoryId: null,
          currency: 'USD',
          amountCents: 10000,
          spentCents: 9000,
          percentUsed: 90,
          alertPercent: 80,
          alertTriggered: true,
          periodStart: null,
          periodEndExclusive: null,
        ),
      ]),
    );
    sync.preferServerPush = true;

    final statuses = await sync.sync();
    expect(statuses, hasLength(1));
    expect(statuses.first.alertTriggered, isTrue);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getStringList('budget_alert_fired_v1'), isNull);
  });
}

import 'package:local_notifications/local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/budget.dart';
import '../utils/money.dart';
import 'budget_repository.dart';

const kBudgetNotificationConfig = LocalNotificationConfig(
  androidChannelId: 'budget_alerts',
  androidChannelName: 'Budget alerts',
  androidChannelDescription: 'Alerts when spending reaches a budget threshold',
  cacheKey: 'budget_notification_plan_v1',
);

const _firedPrefsKey = 'budget_alert_fired_v1';

/// Syncs budget threshold alerts.
///
/// When [preferServerPush] is true (FCM configured + registered), local
/// threshold `showNow` is skipped — the API sends pushes and the foreground
/// bridge displays them. Otherwise falls back to client-side local alerts.
class BudgetAlertSync {
  BudgetAlertSync({
    BudgetRepository? repository,
    LocalNotificationService? notificationService,
  })  : _repository = repository,
        _notifications = notificationService ?? LocalNotificationService.instance;

  BudgetRepository? _repository;
  final LocalNotificationService _notifications;

  /// When true, skip client-side local threshold notifications.
  bool preferServerPush = false;

  void attachRepository(BudgetRepository repository) {
    _repository = repository;
  }

  void clearRepository() {
    _repository = null;
  }

  Future<void> ensureInitialized() =>
      _notifications.ensureInitialized(kBudgetNotificationConfig);

  Future<void> cancelAll() => _notifications.cancelAll();

  /// Fetches current statuses and optionally fires local notifications for
  /// newly crossed thresholds (once per budget + period).
  Future<List<BudgetStatus>> sync({
    String? asOf,
    String Function(BudgetStatus status)? titleFor,
    String Function(BudgetStatus status)? bodyFor,
  }) async {
    final repo = _repository;
    if (repo == null) return const [];

    final statuses = await repo.fetchStatuses(asOf: asOf);
    if (preferServerPush) {
      return statuses;
    }

    final prefs = await SharedPreferences.getInstance();
    final fired = prefs.getStringList(_firedPrefsKey)?.toSet() ?? <String>{};

    for (final status in statuses) {
      if (!status.alertTriggered) continue;
      final periodKey = status.periodStart == null
          ? 'none'
          : dateOnly(status.periodStart!);
      final key = '${status.budgetId}|$periodKey';
      if (fired.contains(key)) continue;

      await _notifications.showNow(
        ImmediateNotification(
          id: _notificationId(status.budgetId, periodKey),
          title: titleFor?.call(status) ?? status.budgetName,
          body: bodyFor?.call(status) ??
              '${status.percentUsed}% of budget used '
                  '(${formatMoney(status.spentCents, currency: status.currency)} / '
                  '${formatMoney(status.amountCents, currency: status.currency)})',
        ),
      );
      fired.add(key);
    }

    await prefs.setStringList(_firedPrefsKey, fired.toList());
    return statuses;
  }

  static int _notificationId(int budgetId, String periodKey) {
    var hash = 17;
    hash = 37 * hash + budgetId;
    hash = 37 * hash + periodKey.hashCode;
    return hash.abs() & 0x7fffffff;
  }
}

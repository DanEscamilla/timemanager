import 'dart:async';

import 'package:flutter/widgets.dart';

import '../config/api_config.dart';
import '../l10n/app_localizations.dart';
import '../screens/budgets_screen.dart';
import '../screens/categories_screen.dart';
import '../screens/expenses_screen.dart';
import '../screens/overview_screen.dart';
import '../services/auth_service.dart';
import '../services/budget_alert_sync.dart';
import '../services/budget_repository.dart';
import '../services/category_repository.dart';
import '../services/expense_repository.dart';
import '../services/graphql_client.dart';
import '../services/idle_session_monitor.dart';
import '../utils/money.dart';

/// Session + GraphQL services for the signed-in shell.
class AuthController extends ChangeNotifier {
  AuthController({
    AuthService? authService,
    CategoryRepository? categoryRepository,
    ExpenseRepository? expenseRepository,
    BudgetRepository? budgetRepository,
    BudgetAlertSync? budgetAlertSync,
    IdleSessionMonitor? idleSessionMonitor,
    Duration? idleSessionTimeout,
  })  : _auth = authService ?? AuthService(),
        _categoryRepository = categoryRepository,
        _expenseRepository = expenseRepository,
        _budgetRepository = budgetRepository,
        _budgetAlertSync = budgetAlertSync ?? BudgetAlertSync() {
    _idleMonitor = idleSessionMonitor ??
        IdleSessionMonitor(
          timeout: idleSessionTimeout ?? ApiConfig.idleSessionTimeout,
          onIdle: signOut,
        );
  }

  final AuthService _auth;
  late final IdleSessionMonitor _idleMonitor;
  final BudgetAlertSync _budgetAlertSync;

  bool? _signedIn;

  CategoryRepository? _categoryRepository;
  ExpenseRepository? _expenseRepository;
  BudgetRepository? _budgetRepository;

  /// Optional l10n lookup for alert notification copy (set from MaterialApp).
  AppLocalizations? Function()? localizationLookup;

  final overviewKey = GlobalKey<OverviewScreenState>();
  final expensesKey = GlobalKey<ExpensesScreenState>();
  final categoriesKey = GlobalKey<CategoriesScreenState>();
  final budgetsKey = GlobalKey<BudgetsScreenState>();

  AuthService get authService => _auth;

  IdleSessionMonitor get idleSessionMonitor => _idleMonitor;

  BudgetAlertSync get budgetAlertSync => _budgetAlertSync;

  bool get isLoading => _signedIn == null;

  bool get isSignedIn => _signedIn == true;

  CategoryRepository get categoryRepository {
    final repo = _categoryRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  ExpenseRepository get expenseRepository {
    final repo = _expenseRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  BudgetRepository get budgetRepository {
    final repo = _budgetRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  Future<void> bootstrap() async {
    try {
      final completed = await _auth.completeOAuthFromCurrentUri();
      if (completed) {
        _ensureSessionServices();
        _signedIn = true;
        _idleMonitor.start();
        notifyListeners();
        unawaited(syncBudgetAlerts());
        return;
      }
    } catch (_) {
      // Fall through to normal session check.
    }

    final exists = await _auth.doesSessionExist();
    if (exists) {
      _ensureSessionServices();
      _idleMonitor.start();
      unawaited(syncBudgetAlerts());
    }
    _signedIn = exists;
    notifyListeners();
  }

  void onAuthenticated() {
    _ensureSessionServices();
    _signedIn = true;
    _idleMonitor.start();
    notifyListeners();
    unawaited(syncBudgetAlerts());
  }

  void recordActivity() {
    if (!isSignedIn) return;
    _idleMonitor.recordActivity();
  }

  Future<void> signOut() async {
    _idleMonitor.stop();
    unawaited(_budgetAlertSync.cancelAll());
    await _auth.signOut();
    _categoryRepository = null;
    _expenseRepository = null;
    _budgetRepository = null;
    _budgetAlertSync.clearRepository();
    _signedIn = false;
    notifyListeners();
  }

  void reloadAll() {
    overviewKey.currentState?.reload();
    expensesKey.currentState?.reload();
    categoriesKey.currentState?.reload();
    budgetsKey.currentState?.reload();
    unawaited(syncBudgetAlerts());
  }

  Future<void> syncBudgetAlerts() async {
    if (!isSignedIn) return;
    try {
      final l10n = localizationLookup?.call();
      await _budgetAlertSync.sync(
        titleFor: l10n == null
            ? null
            : (status) => l10n.budgetAlertTitle(status.budgetName),
        bodyFor: l10n == null
            ? null
            : (status) => l10n.budgetAlertBody(
                  status.percentUsed,
                  formatMoney(
                    status.spentCents,
                    currency: status.currency,
                  ),
                  formatMoney(
                    status.amountCents,
                    currency: status.currency,
                  ),
                ),
      );
    } catch (_) {
      // Best-effort alert delivery.
    }
  }

  void _ensureSessionServices() {
    if (_expenseRepository != null && _budgetRepository != null) return;

    final client = GraphQLClient(
      authService: _auth,
      onUnauthorized: () async {
        await signOut();
      },
    );
    _categoryRepository ??= CategoryRepository(client: client);
    _expenseRepository ??= ExpenseRepository(client: client);
    _budgetRepository ??= BudgetRepository(client: client);
    _budgetAlertSync.attachRepository(_budgetRepository!);
  }

  @override
  void dispose() {
    _idleMonitor.stop();
    super.dispose();
  }
}

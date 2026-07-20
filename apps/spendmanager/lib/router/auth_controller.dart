import 'dart:async';

import 'package:flutter/widgets.dart';

import '../config/api_config.dart';
import '../screens/categories_screen.dart';
import '../screens/expenses_screen.dart';
import '../screens/overview_screen.dart';
import '../services/auth_service.dart';
import '../services/category_repository.dart';
import '../services/expense_repository.dart';
import '../services/graphql_client.dart';
import '../services/idle_session_monitor.dart';

/// Session + GraphQL services for the signed-in shell.
class AuthController extends ChangeNotifier {
  AuthController({
    AuthService? authService,
    CategoryRepository? categoryRepository,
    ExpenseRepository? expenseRepository,
    IdleSessionMonitor? idleSessionMonitor,
    Duration? idleSessionTimeout,
  })  : _auth = authService ?? AuthService(),
        _categoryRepository = categoryRepository,
        _expenseRepository = expenseRepository {
    _idleMonitor = idleSessionMonitor ??
        IdleSessionMonitor(
          timeout: idleSessionTimeout ?? ApiConfig.idleSessionTimeout,
          onIdle: signOut,
        );
  }

  final AuthService _auth;
  late final IdleSessionMonitor _idleMonitor;

  bool? _signedIn;

  CategoryRepository? _categoryRepository;
  ExpenseRepository? _expenseRepository;

  final overviewKey = GlobalKey<OverviewScreenState>();
  final expensesKey = GlobalKey<ExpensesScreenState>();
  final categoriesKey = GlobalKey<CategoriesScreenState>();

  AuthService get authService => _auth;

  IdleSessionMonitor get idleSessionMonitor => _idleMonitor;

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

  Future<void> bootstrap() async {
    try {
      final completed = await _auth.completeOAuthFromCurrentUri();
      if (completed) {
        _ensureSessionServices();
        _signedIn = true;
        _idleMonitor.start();
        notifyListeners();
        return;
      }
    } catch (_) {
      // Fall through to normal session check.
    }

    final exists = await _auth.doesSessionExist();
    if (exists) {
      _ensureSessionServices();
      _idleMonitor.start();
    }
    _signedIn = exists;
    notifyListeners();
  }

  void onAuthenticated() {
    _ensureSessionServices();
    _signedIn = true;
    _idleMonitor.start();
    notifyListeners();
  }

  void recordActivity() {
    if (!isSignedIn) return;
    _idleMonitor.recordActivity();
  }

  Future<void> signOut() async {
    _idleMonitor.stop();
    await _auth.signOut();
    _categoryRepository = null;
    _expenseRepository = null;
    _signedIn = false;
    notifyListeners();
  }

  void reloadAll() {
    overviewKey.currentState?.reload();
    expensesKey.currentState?.reload();
    categoriesKey.currentState?.reload();
  }

  void _ensureSessionServices() {
    if (_expenseRepository != null) return;

    final client = GraphQLClient(
      authService: _auth,
      onUnauthorized: () async {
        await signOut();
      },
    );
    _categoryRepository = CategoryRepository(client: client);
    _expenseRepository = ExpenseRepository(client: client);
  }

  @override
  void dispose() {
    _idleMonitor.stop();
    super.dispose();
  }
}

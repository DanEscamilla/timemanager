import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:timemanager/l10n/app_localizations.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/models/goal.dart';
import 'package:timemanager/models/group.dart';
import 'package:timemanager/router/app_router.dart';
import 'package:timemanager/router/app_routes.dart';
import 'package:timemanager/router/auth_controller.dart';
import 'package:timemanager/screens/login_screen.dart';
import 'package:timemanager/services/activity_repository.dart';
import 'package:timemanager/services/auth_service.dart';
import 'package:timemanager/services/goal_repository.dart';
import 'package:timemanager/services/group_repository.dart';
import 'package:timemanager/widgets/loading_view.dart';

class _FakeAuthService extends AuthService {
  _FakeAuthService({this.sessionExists = false});

  final bool sessionExists;

  @override
  Future<bool> doesSessionExist() async => sessionExists;

  @override
  Future<bool> completeOAuthFromCurrentUri() async => false;

  @override
  Future<void> signOut() async {}
}

class _FakeActivityRepository extends ActivityRepository {
  @override
  Future<List<Activity>> fetchActivities() async => const [];
}

class _FakeGroupRepository extends GroupRepository {
  @override
  Future<List<ActivityGroup>> fetchGroups() async => const [];
}

class _FakeGoalRepository extends GoalRepository {
  @override
  Future<List<Goal>> fetchGoals({String? status}) async => const [];

  @override
  Future<DailyProgress> fetchDailyProgress({String? date}) async =>
      const DailyProgress(
        date: '2026-07-13',
        completedCount: 0,
        minutesToday: 0,
        streakDays: 0,
      );

  @override
  Future<List<GoalNudge>> fetchNudges() async => const [];
}

class _FakeCompletionRepository extends CompletionRepository {
  @override
  Future<List<ActivityCompletion>> fetchCompletions({
    int? activityId,
    String? fromDate,
    String? toDate,
  }) async =>
      const [];
}

Widget _app(GoRouter router) {
  return MaterialApp.router(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    routerConfig: router,
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('signed-out user is redirected to login', (tester) async {
    final auth = AuthController(authService: _FakeAuthService());
    final themeMode = ValueNotifier(ThemeMode.system);
    final rootKey = GlobalKey<NavigatorState>();
    final router = createAppRouter(
      auth: auth,
      rootNavigatorKey: rootKey,
      themeMode: themeMode,
      onThemeModeChanged: (_) {},
    );

    await tester.pumpWidget(_app(router));
    expect(find.byType(LoadingView), findsOneWidget);

    await auth.bootstrap();
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(router.state.uri.path, AppRoutes.login);

    themeMode.dispose();
    router.dispose();
    auth.dispose();
  });

  testWidgets('signed-in go() updates matched path', (tester) async {
    final auth = AuthController(
      authService: _FakeAuthService(sessionExists: true),
      activityRepository: _FakeActivityRepository(),
      groupRepository: _FakeGroupRepository(),
      goalRepository: _FakeGoalRepository(),
      completionRepository: _FakeCompletionRepository(),
    );
    final themeMode = ValueNotifier(ThemeMode.system);
    final rootKey = GlobalKey<NavigatorState>();
    final router = createAppRouter(
      auth: auth,
      rootNavigatorKey: rootKey,
      themeMode: themeMode,
      onThemeModeChanged: (_) {},
    );

    await auth.bootstrap();

    await tester.pumpWidget(_app(router));
    await tester.pumpAndSettle();

    expect(router.state.uri.path, AppRoutes.overview);

    router.go(AppRoutes.calendar);
    await tester.pumpAndSettle();
    expect(router.state.uri.path, AppRoutes.calendar);

    router.go(AppRoutes.activities);
    await tester.pumpAndSettle();
    expect(router.state.uri.path, AppRoutes.activities);

    themeMode.dispose();
    router.dispose();
    auth.dispose();
  });
}

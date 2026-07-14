import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../screens/activities_screen.dart';
import '../screens/calendar_screen.dart';
import '../screens/goals_screen.dart';
import '../screens/groups_screen.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/overview_screen.dart';
import '../screens/settings_screen.dart';
import '../widgets/loading_view.dart';
import 'app_routes.dart';
import 'auth_controller.dart';

/// Builds the app [GoRouter] with URL-synced shell tabs and auth redirects.
GoRouter createAppRouter({
  required AuthController auth,
  required GlobalKey<NavigatorState> rootNavigatorKey,
  required ValueNotifier<ThemeMode> themeMode,
  required ValueChanged<ThemeMode> onThemeModeChanged,
}) {
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: AppRoutes.overview,
    refreshListenable: auth,
    redirect: (context, state) {
      final loc = state.matchedLocation;

      if (auth.isLoading) {
        return loc == AppRoutes.loading ? null : AppRoutes.loading;
      }

      if (loc == AppRoutes.loading) {
        return auth.isSignedIn ? AppRoutes.overview : AppRoutes.login;
      }

      final loggingIn = loc == AppRoutes.login;
      if (!auth.isSignedIn && !loggingIn) return AppRoutes.login;
      if (auth.isSignedIn && loggingIn) return AppRoutes.overview;

      if (loc == '/') {
        return auth.isSignedIn ? AppRoutes.overview : AppRoutes.login;
      }

      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.loading,
        builder: (context, state) =>
            const Scaffold(body: LoadingView()),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => LoginScreen(
          authService: auth.authService,
          onAuthenticated: auth.onAuthenticated,
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return HomeScreen(
            navigationShell: navigationShell,
            authController: auth,
          );
        },
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.overview,
                builder: (context, state) => OverviewScreen(
                  key: auth.overviewKey,
                  repository: auth.activityRepository,
                  groupRepository: auth.groupRepository,
                  goalRepository: auth.goalRepository,
                  completionRepository: auth.completionRepository,
                  onOpenCalendar: () => context.go(AppRoutes.calendar),
                  onOpenActivities: () => context.go(AppRoutes.activities),
                  onOpenGoals: () => context.go(AppRoutes.goals),
                  onChanged: auth.reloadAll,
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.activities,
                builder: (context, state) => ActivitiesScreen(
                  key: auth.activitiesKey,
                  repository: auth.activityRepository,
                  groupRepository: auth.groupRepository,
                  onChanged: () {
                    auth.calendarKey.currentState?.reload();
                    auth.overviewKey.currentState?.reload();
                    auth.goalsKey.currentState?.reload();
                  },
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.calendar,
                builder: (context, state) => CalendarScreen(
                  key: auth.calendarKey,
                  repository: auth.activityRepository,
                  groupRepository: auth.groupRepository,
                  completionRepository: auth.completionRepository,
                  onChanged: () {
                    auth.activitiesKey.currentState?.reload();
                    auth.overviewKey.currentState?.reload();
                    auth.goalsKey.currentState?.reload();
                  },
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.goals,
                builder: (context, state) => GoalsScreen(
                  key: auth.goalsKey,
                  goalRepository: auth.goalRepository,
                  activityRepository: auth.activityRepository,
                  groupRepository: auth.groupRepository,
                  onChanged: auth.reloadAll,
                ),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes.groups,
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) => GroupsScreen(
          repository: auth.groupRepository,
          onChanged: auth.reloadAll,
        ),
      ),
      GoRoute(
        path: AppRoutes.settings,
        parentNavigatorKey: rootNavigatorKey,
        builder: (context, state) {
          return ValueListenableBuilder<ThemeMode>(
            valueListenable: themeMode,
            builder: (context, mode, _) {
              return SettingsScreen(
                themeMode: mode,
                onThemeModeChanged: onThemeModeChanged,
                onSignedOut: auth.signOut,
              );
            },
          );
        },
      ),
    ],
  );
}

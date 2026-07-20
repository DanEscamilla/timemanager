import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:design_system/design_system.dart';

import '../screens/categories_screen.dart';
import '../screens/expenses_screen.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/overview_screen.dart';
import '../screens/settings_screen.dart';
import 'app_routes.dart';
import 'auth_controller.dart';

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
                  expenseRepository: auth.expenseRepository,
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.expenses,
                builder: (context, state) => ExpensesScreen(
                  key: auth.expensesKey,
                  expenseRepository: auth.expenseRepository,
                  categoryRepository: auth.categoryRepository,
                  onChanged: auth.reloadAll,
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: AppRoutes.categories,
                builder: (context, state) => CategoriesScreen(
                  key: auth.categoriesKey,
                  repository: auth.categoryRepository,
                  onChanged: auth.reloadAll,
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  );
}

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../router/app_routes.dart';
import '../router/auth_controller.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.navigationShell,
    required this.authController,
  });

  final StatefulNavigationShell navigationShell;
  final AuthController authController;

  static const _overviewIndex = 0;
  static const _expensesIndex = 1;
  static const _categoriesIndex = 2;

  void _onFabPressed() {
    switch (navigationShell.currentIndex) {
      case _expensesIndex:
        authController.expensesKey.currentState?.openCreateForm();
      case _categoriesIndex:
        authController.categoriesKey.currentState?.openCreateForm();
      default:
        authController.expensesKey.currentState?.openCreateForm();
        navigationShell.goBranch(_expensesIndex);
    }
  }

  String _title(AppLocalizations l10n) {
    return switch (navigationShell.currentIndex) {
      _overviewIndex => l10n.navOverview,
      _expensesIndex => l10n.navExpenses,
      _ => l10n.navCategories,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final wide = MediaQuery.sizeOf(context).width >= AppBreakpoints.medium;
    final index = navigationShell.currentIndex;

    final destinations = [
      NavigationDestination(
        icon: const Icon(Icons.dashboard_outlined),
        selectedIcon: const Icon(Icons.dashboard),
        label: l10n.navOverview,
      ),
      NavigationDestination(
        icon: const Icon(Icons.payments_outlined),
        selectedIcon: const Icon(Icons.payments),
        label: l10n.navExpenses,
      ),
      NavigationDestination(
        icon: const Icon(Icons.category_outlined),
        selectedIcon: const Icon(Icons.category),
        label: l10n.navCategories,
      ),
    ];

    final railDestinations = [
      NavigationRailDestination(
        icon: const Icon(Icons.dashboard_outlined),
        selectedIcon: const Icon(Icons.dashboard),
        label: Text(l10n.navOverview),
      ),
      NavigationRailDestination(
        icon: const Icon(Icons.payments_outlined),
        selectedIcon: const Icon(Icons.payments),
        label: Text(l10n.navExpenses),
      ),
      NavigationRailDestination(
        icon: const Icon(Icons.category_outlined),
        selectedIcon: const Icon(Icons.category),
        label: Text(l10n.navCategories),
      ),
    ];

    final body = navigationShell;

    return Scaffold(
      appBar: AppBar(
        title: Text(_title(l10n)),
        actions: [
          IconButton(
            tooltip: l10n.tooltipRefresh,
            onPressed: authController.reloadAll,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: l10n.tooltipSettings,
            onPressed: () => context.push(AppRoutes.settings),
            icon: const Icon(Icons.settings_outlined),
          ),
          IconButton(
            tooltip: l10n.tooltipSignOut,
            onPressed: authController.signOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _onFabPressed,
        tooltip: index == _categoriesIndex
            ? l10n.tooltipAddCategory
            : l10n.tooltipAddExpense,
        child: const Icon(Icons.add),
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: index,
                  onDestinationSelected: (i) {
                    navigationShell.goBranch(
                      i,
                      initialLocation: i == index,
                    );
                  },
                  labelType: NavigationRailLabelType.all,
                  destinations: railDestinations,
                ),
                const VerticalDivider(width: 1),
                Expanded(child: body),
              ],
            )
          : body,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) {
                navigationShell.goBranch(
                  i,
                  initialLocation: i == index,
                );
              },
              destinations: destinations,
            ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../l10n/app_localizations.dart';
import '../router/app_routes.dart';
import '../router/auth_controller.dart';
import '../theme/tokens/app_breakpoints.dart';

/// App shell: Overview + Activities + Calendar with URL-synced navigation.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.navigationShell,
    required this.authController,
  });

  final StatefulNavigationShell navigationShell;
  final AuthController authController;

  static const _overviewIndex = 0;
  static const _activitiesIndex = 1;
  static const _calendarIndex = 2;

  void _onFabPressed() {
    switch (navigationShell.currentIndex) {
      case _overviewIndex:
        authController.overviewKey.currentState?.openCreateForm();
      case _activitiesIndex:
        authController.activitiesKey.currentState?.openCreateForm();
      case _calendarIndex:
        authController.calendarKey.currentState?.openCreateForSelectedDay();
    }
  }

  String _title(AppLocalizations l10n) {
    return switch (navigationShell.currentIndex) {
      _overviewIndex => l10n.navOverview,
      _activitiesIndex => l10n.navActivities,
      _ => l10n.navCalendar,
    };
  }

  void _onDestinationSelected(int index) {
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
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
        icon: const Icon(Icons.list_alt_outlined),
        selectedIcon: const Icon(Icons.list_alt),
        label: l10n.navActivities,
      ),
      NavigationDestination(
        icon: const Icon(Icons.calendar_today_outlined),
        selectedIcon: const Icon(Icons.calendar_today),
        label: l10n.navCalendar,
      ),
    ];

    final railDestinations = [
      NavigationRailDestination(
        icon: const Icon(Icons.dashboard_outlined),
        selectedIcon: const Icon(Icons.dashboard),
        label: Text(l10n.navOverview),
      ),
      NavigationRailDestination(
        icon: const Icon(Icons.list_alt_outlined),
        selectedIcon: const Icon(Icons.list_alt),
        label: Text(l10n.navActivities),
      ),
      NavigationRailDestination(
        icon: const Icon(Icons.calendar_today_outlined),
        selectedIcon: const Icon(Icons.calendar_today),
        label: Text(l10n.navCalendar),
      ),
    ];

    final fabTooltip = index == _calendarIndex
        ? l10n.tooltipAddActivityForDay
        : l10n.tooltipAddActivity;

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
            tooltip: l10n.tooltipGroups,
            onPressed: () => context.push(AppRoutes.groups),
            icon: const Icon(Icons.folder_outlined),
          ),
          IconButton(
            tooltip: l10n.tooltipSettings,
            onPressed: () => context.push(AppRoutes.settings),
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: index,
                  onDestinationSelected: _onDestinationSelected,
                  labelType: NavigationRailLabelType.all,
                  destinations: railDestinations,
                ),
                const VerticalDivider(width: 1),
                Expanded(child: navigationShell),
              ],
            )
          : navigationShell,
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      floatingActionButton: FloatingActionButton(
        onPressed: _onFabPressed,
        tooltip: fabTooltip,
        child: const Icon(Icons.add),
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: _onDestinationSelected,
              destinations: destinations,
            ),
    );
  }
}

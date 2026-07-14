import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../l10n/app_localizations.dart';
import '../router/app_routes.dart';
import '../router/auth_controller.dart';
import '../theme/tokens/app_breakpoints.dart';

/// App shell: Overview + Activities + Calendar + Goals + Rewards.
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
  static const _goalsIndex = 3;
  static const _rewardsIndex = 4;

  void _onFabPressed() {
    switch (navigationShell.currentIndex) {
      case _overviewIndex:
        authController.overviewKey.currentState?.openCreateForm();
      case _activitiesIndex:
        authController.activitiesKey.currentState?.openCreateForm();
      case _calendarIndex:
        authController.calendarKey.currentState?.openCreateForSelectedDay();
      case _goalsIndex:
        authController.goalsKey.currentState?.openCreateForm();
      case _rewardsIndex:
        authController.rewardsKey.currentState?.openCreateForm();
    }
  }

  String _title(AppLocalizations l10n) {
    return switch (navigationShell.currentIndex) {
      _overviewIndex => l10n.navOverview,
      _activitiesIndex => l10n.navActivities,
      _calendarIndex => l10n.navCalendar,
      _goalsIndex => l10n.navGoals,
      _ => l10n.navRewards,
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
      NavigationDestination(
        icon: const Icon(Icons.flag_outlined),
        selectedIcon: const Icon(Icons.flag),
        label: l10n.navGoals,
      ),
      NavigationDestination(
        icon: const Icon(Icons.card_giftcard_outlined),
        selectedIcon: const Icon(Icons.card_giftcard),
        label: l10n.navRewards,
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
      NavigationRailDestination(
        icon: const Icon(Icons.flag_outlined),
        selectedIcon: const Icon(Icons.flag),
        label: Text(l10n.navGoals),
      ),
      NavigationRailDestination(
        icon: const Icon(Icons.card_giftcard_outlined),
        selectedIcon: const Icon(Icons.card_giftcard),
        label: Text(l10n.navRewards),
      ),
    ];

    final fabTooltip = switch (index) {
      _calendarIndex => l10n.tooltipAddActivityForDay,
      _goalsIndex => l10n.tooltipAddGoal,
      _rewardsIndex => l10n.tooltipAddReward,
      _ => l10n.tooltipAddActivity,
    };

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

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../theme/tokens/app_breakpoints.dart';
import '../services/activity_repository.dart';
import '../services/auth_service.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import 'activities_screen.dart';
import 'calendar_screen.dart';
import 'groups_screen.dart';
import 'overview_screen.dart';
import 'settings_screen.dart';

/// App shell: Overview + Activities + Calendar with responsive navigation.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    this.repository,
    this.groupRepository,
    this.authService,
    this.onSignedOut,
    this.themeMode = ThemeMode.system,
    this.onThemeModeChanged,
  });

  final ActivityRepository? repository;
  final GroupRepository? groupRepository;
  final AuthService? authService;
  final Future<void> Function()? onSignedOut;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode>? onThemeModeChanged;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final AuthService _auth = widget.authService ?? AuthService();
  late final GraphQLClient _client = GraphQLClient(
    authService: _auth,
    onUnauthorized: () async {
      await widget.onSignedOut?.call();
    },
  );
  late final ActivityRepository _repository =
      widget.repository ?? ActivityRepository(client: _client);
  late final GroupRepository _groupRepository =
      widget.groupRepository ?? GroupRepository(client: _client);

  final _overviewKey = GlobalKey<OverviewScreenState>();
  final _activitiesKey = GlobalKey<ActivitiesScreenState>();
  final _calendarKey = GlobalKey<CalendarScreenState>();

  int _index = 0;

  static const _overviewIndex = 0;
  static const _activitiesIndex = 1;
  static const _calendarIndex = 2;

  void _reloadAll() {
    _overviewKey.currentState?.reload();
    _activitiesKey.currentState?.reload();
    _calendarKey.currentState?.reload();
  }

  void _onFabPressed() {
    switch (_index) {
      case _overviewIndex:
        _overviewKey.currentState?.openCreateForm();
      case _activitiesIndex:
        _activitiesKey.currentState?.openCreateForm();
      case _calendarIndex:
        _calendarKey.currentState?.openCreateForSelectedDay();
    }
  }

  String _title(AppLocalizations l10n) {
    return switch (_index) {
      _overviewIndex => l10n.navOverview,
      _activitiesIndex => l10n.navActivities,
      _ => l10n.navCalendar,
    };
  }

  Future<void> _openGroups() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => GroupsScreen(
          repository: _groupRepository,
          onChanged: _reloadAll,
        ),
      ),
    );
  }

  Future<void> _openSettings() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SettingsScreen(
          themeMode: widget.themeMode,
          onThemeModeChanged: (mode) {
            widget.onThemeModeChanged?.call(mode);
          },
          onSignedOut: widget.onSignedOut,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final wide =
        MediaQuery.sizeOf(context).width >= AppBreakpoints.medium;

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

    final body = IndexedStack(
      index: _index,
      children: [
        OverviewScreen(
          key: _overviewKey,
          repository: _repository,
          groupRepository: _groupRepository,
          onOpenCalendar: () => setState(() => _index = _calendarIndex),
          onOpenActivities: () => setState(() => _index = _activitiesIndex),
          onChanged: _reloadAll,
        ),
        ActivitiesScreen(
          key: _activitiesKey,
          repository: _repository,
          groupRepository: _groupRepository,
          onChanged: () {
            _calendarKey.currentState?.reload();
            _overviewKey.currentState?.reload();
          },
        ),
        CalendarScreen(
          key: _calendarKey,
          repository: _repository,
          groupRepository: _groupRepository,
          onChanged: () {
            _activitiesKey.currentState?.reload();
            _overviewKey.currentState?.reload();
          },
        ),
      ],
    );

    final fabTooltip = _index == _calendarIndex
        ? l10n.tooltipAddActivityForDay
        : l10n.tooltipAddActivity;

    return Scaffold(
      appBar: AppBar(
        title: Text(_title(l10n)),
        actions: [
          IconButton(
            tooltip: l10n.tooltipRefresh,
            onPressed: _reloadAll,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: l10n.tooltipGroups,
            onPressed: _openGroups,
            icon: const Icon(Icons.folder_outlined),
          ),
          IconButton(
            tooltip: l10n.tooltipSettings,
            onPressed: _openSettings,
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: _index,
                  onDestinationSelected: (index) =>
                      setState(() => _index = index),
                  labelType: NavigationRailLabelType.all,
                  destinations: railDestinations,
                ),
                const VerticalDivider(width: 1),
                Expanded(child: body),
              ],
            )
          : body,
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      floatingActionButton: FloatingActionButton(
        onPressed: _onFabPressed,
        tooltip: fabTooltip,
        child: const Icon(Icons.add),
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (index) =>
                  setState(() => _index = index),
              destinations: destinations,
            ),
    );
  }
}

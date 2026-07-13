import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/activity_repository.dart';
import '../services/auth_service.dart';
import '../services/graphql_client.dart';
import 'activities_screen.dart';
import 'calendar_screen.dart';

/// Bottom-nav shell: Activities list + Day/Week/Month calendar.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    this.repository,
    this.authService,
    this.onSignedOut,
  });

  final ActivityRepository? repository;
  final AuthService? authService;
  final Future<void> Function()? onSignedOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final AuthService _auth = widget.authService ?? AuthService();
  late final ActivityRepository _repository = widget.repository ??
      ActivityRepository(
        client: GraphQLClient(
          authService: _auth,
          onUnauthorized: () async {
            await widget.onSignedOut?.call();
          },
        ),
      );

  final _activitiesKey = GlobalKey<ActivitiesScreenState>();
  final _calendarKey = GlobalKey<CalendarScreenState>();

  int _index = 0;

  void _reloadAll() {
    _activitiesKey.currentState?.reload();
    _calendarKey.currentState?.reload();
  }

  void _reloadCurrent() {
    _reloadAll();
  }

  void _onFabPressed() {
    if (_index == 0) {
      _activitiesKey.currentState?.openCreateForm();
    } else {
      _calendarKey.currentState?.openCreateForSelectedDay();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_index == 0 ? l10n.navActivities : l10n.navCalendar),
        actions: [
          IconButton(
            tooltip: l10n.tooltipRefresh,
            onPressed: _reloadCurrent,
            icon: const Icon(Icons.refresh),
          ),
          if (widget.onSignedOut != null)
            IconButton(
              tooltip: l10n.tooltipSignOut,
              onPressed: widget.onSignedOut,
              icon: const Icon(Icons.logout),
            ),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: [
          ActivitiesScreen(
            key: _activitiesKey,
            repository: _repository,
            embedded: true,
            onChanged: () => _calendarKey.currentState?.reload(),
          ),
          CalendarScreen(
            key: _calendarKey,
            repository: _repository,
            embedded: true,
            onChanged: () => _activitiesKey.currentState?.reload(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _onFabPressed,
        tooltip: _index == 0
            ? l10n.tooltipAddActivity
            : l10n.tooltipAddActivityForDay,
        child: const Icon(Icons.add),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: [
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
        ],
      ),
    );
  }
}

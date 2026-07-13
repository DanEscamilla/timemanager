import 'package:flutter/widgets.dart';

import '../screens/activities_screen.dart';
import '../screens/calendar_screen.dart';
import '../screens/overview_screen.dart';
import '../services/activity_repository.dart';
import '../services/auth_service.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';

/// Session + GraphQL services for the signed-in shell.
///
/// Drives [GoRouter] redirects via [ChangeNotifier].
class AuthController extends ChangeNotifier {
  AuthController({
    AuthService? authService,
    ActivityRepository? activityRepository,
    GroupRepository? groupRepository,
  })  : _auth = authService ?? AuthService(),
        _activityRepository = activityRepository,
        _groupRepository = groupRepository;

  final AuthService _auth;

  /// `null` while [bootstrap] is in progress.
  bool? _signedIn;

  ActivityRepository? _activityRepository;
  GroupRepository? _groupRepository;

  final overviewKey = GlobalKey<OverviewScreenState>();
  final activitiesKey = GlobalKey<ActivitiesScreenState>();
  final calendarKey = GlobalKey<CalendarScreenState>();

  AuthService get authService => _auth;

  bool get isLoading => _signedIn == null;

  bool get isSignedIn => _signedIn == true;

  ActivityRepository get activityRepository {
    final repo = _activityRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  GroupRepository get groupRepository {
    final repo = _groupRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  Future<void> bootstrap() async {
    try {
      final completed = await _auth.completeOAuthFromCurrentUri();
      if (completed) {
        _ensureSessionServices();
        _signedIn = true;
        notifyListeners();
        return;
      }
    } catch (_) {
      // Fall through to normal session check; login screen can show errors.
    }

    final exists = await _auth.doesSessionExist();
    if (exists) {
      _ensureSessionServices();
    }
    _signedIn = exists;
    notifyListeners();
  }

  void onAuthenticated() {
    _ensureSessionServices();
    _signedIn = true;
    notifyListeners();
  }

  Future<void> signOut() async {
    await _auth.signOut();
    _activityRepository = null;
    _groupRepository = null;
    _signedIn = false;
    notifyListeners();
  }

  void reloadAll() {
    overviewKey.currentState?.reload();
    activitiesKey.currentState?.reload();
    calendarKey.currentState?.reload();
  }

  void _ensureSessionServices() {
    if (_activityRepository != null) return;

    final client = GraphQLClient(
      authService: _auth,
      onUnauthorized: () async {
        await signOut();
      },
    );
    _activityRepository = ActivityRepository(client: client);
    _groupRepository = GroupRepository(client: client);
  }
}

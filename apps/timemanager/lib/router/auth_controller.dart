import 'package:flutter/widgets.dart';

import '../screens/activities_screen.dart';
import '../screens/calendar_screen.dart';
import '../screens/goals_screen.dart';
import '../screens/overview_screen.dart';
import '../screens/rewards_screen.dart';
import '../services/activity_repository.dart';
import '../services/asset_upload_service.dart';
import '../services/auth_service.dart';
import '../services/goal_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../services/reward_repository.dart';

/// Session + GraphQL services for the signed-in shell.
///
/// Drives [GoRouter] redirects via [ChangeNotifier].
class AuthController extends ChangeNotifier {
  AuthController({
    AuthService? authService,
    ActivityRepository? activityRepository,
    GroupRepository? groupRepository,
    GoalRepository? goalRepository,
    CompletionRepository? completionRepository,
    RewardRepository? rewardRepository,
    AssetUploadService? assetUploadService,
  })  : _auth = authService ?? AuthService(),
        _activityRepository = activityRepository,
        _groupRepository = groupRepository,
        _goalRepository = goalRepository,
        _completionRepository = completionRepository,
        _rewardRepository = rewardRepository,
        _assetUploadService = assetUploadService;

  final AuthService _auth;

  /// `null` while [bootstrap] is in progress.
  bool? _signedIn;

  ActivityRepository? _activityRepository;
  GroupRepository? _groupRepository;
  GoalRepository? _goalRepository;
  CompletionRepository? _completionRepository;
  RewardRepository? _rewardRepository;
  AssetUploadService? _assetUploadService;

  final overviewKey = GlobalKey<OverviewScreenState>();
  final activitiesKey = GlobalKey<ActivitiesScreenState>();
  final calendarKey = GlobalKey<CalendarScreenState>();
  final goalsKey = GlobalKey<GoalsScreenState>();
  final rewardsKey = GlobalKey<RewardsScreenState>();

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

  GoalRepository get goalRepository {
    final repo = _goalRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  CompletionRepository get completionRepository {
    final repo = _completionRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  RewardRepository get rewardRepository {
    final repo = _rewardRepository;
    assert(repo != null, 'Session services require a signed-in user');
    return repo!;
  }

  AssetUploadService get assetUploadService {
    final service = _assetUploadService;
    assert(service != null, 'Session services require a signed-in user');
    return service!;
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
    _goalRepository = null;
    _completionRepository = null;
    _rewardRepository = null;
    _assetUploadService = null;
    _signedIn = false;
    notifyListeners();
  }

  void reloadAll() {
    overviewKey.currentState?.reload();
    activitiesKey.currentState?.reload();
    calendarKey.currentState?.reload();
    goalsKey.currentState?.reload();
    rewardsKey.currentState?.reload();
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
    _goalRepository = GoalRepository(client: client);
    _completionRepository = CompletionRepository(client: client);
    _rewardRepository = RewardRepository(client: client);
    _assetUploadService = AssetUploadService(
      authService: _auth,
      onUnauthorized: () async {
        await signOut();
      },
    );
  }
}

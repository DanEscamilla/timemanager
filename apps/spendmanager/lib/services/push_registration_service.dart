import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:local_notifications/local_notifications.dart';
import 'package:push_notifications/push_notifications.dart';

import '../firebase_options.dart';
import 'budget_alert_sync.dart';
import 'graphql_client.dart';

/// Registers FCM tokens with spendmanager-api and bridges foreground pushes
/// to [LocalNotificationService].
class PushRegistrationService {
  PushRegistrationService({
    GraphQLClient? client,
    PushNotificationService? pushService,
    LocalNotificationService? localNotifications,
  })  : _client = client,
        _push = pushService ?? PushNotificationService.instance,
        _local = localNotifications ?? LocalNotificationService.instance;

  GraphQLClient? _client;
  final PushNotificationService _push;
  final LocalNotificationService _local;

  StreamSubscription<String>? _tokenSub;
  StreamSubscription<PushMessage>? _foregroundSub;
  String? _currentToken;
  bool _pushReady = false;

  /// True when Firebase options exist for this platform and push init succeeded.
  bool get isPushEnabled => _pushReady;

  /// True after a device token was registered with the API this session.
  bool get hasRegisteredToken => _currentToken != null;

  void attachClient(GraphQLClient client) {
    _client = client;
  }

  void clearClient() {
    _client = null;
  }

  /// Initializes Firebase + push when configured; otherwise a no-op.
  Future<void> ensureInitialized() async {
    final options = _firebaseOptionsOrNull();
    if (options == null) {
      if (kDebugMode) {
        debugPrint(
          'PushRegistrationService: Firebase not configured for this '
          'platform; using local budget alerts only',
        );
      }
      return;
    }

    try {
      await _local.ensureInitialized(kBudgetNotificationConfig);
      // Optional web VAPID key: --dart-define=FCM_VAPID_KEY=...
      // (Firebase Console → Project settings → Cloud Messaging → Web Push)
      const vapidKey = String.fromEnvironment('FCM_VAPID_KEY');
      await _push.ensureInitialized(
        config: const PushNotificationConfig(appId: 'spendmanager'),
        provider: FirebasePushProvider(
          firebaseOptions: options,
          vapidKey: vapidKey.isEmpty ? null : vapidKey,
        ),
      );
      _pushReady = true;

      _foregroundSub ??= _push.onForegroundMessage.listen(_showForeground);
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint('PushRegistrationService.init failed: $e');
        debugPrint('$st');
      }
      _pushReady = false;
    }
  }

  /// FlutterFire options for the current platform, or null when unsupported
  /// (e.g. Linux).
  static FirebaseOptions? _firebaseOptionsOrNull() {
    try {
      return DefaultFirebaseOptions.currentPlatform;
    } on UnsupportedError {
      return null;
    }
  }

  /// Requests permission, registers token, and listens for refreshes.
  Future<void> start() async {
    if (!_pushReady) return;

    try {
      final granted = await _push.requestPermission();
      if (!granted) {
        if (kDebugMode) {
          debugPrint(
            'PushRegistrationService: notification permission denied; '
            'budget alerts stay local-only. On web, reset site permissions '
            'for this origin if you previously clicked Block.',
          );
        }
        return;
      }

      if (kIsWeb) {
        const vapidKey = String.fromEnvironment('FCM_VAPID_KEY');
        if (vapidKey.isEmpty && kDebugMode) {
          debugPrint(
            'PushRegistrationService: FCM_VAPID_KEY not set; web getToken '
            'may fail. Pass --dart-define=FCM_VAPID_KEY=... (Firebase Console '
            '→ Project settings → Cloud Messaging → Web Push certificates).',
          );
        }
      }

      final token = await _push.getToken();
      if (token != null) {
        await _register(token);
      }
      _tokenSub ??= _push.onTokenRefresh.listen((token) {
        unawaited(_register(token));
      });
    } catch (e) {
      if (kDebugMode) {
        debugPrint('PushRegistrationService.start failed: $e');
      }
    }
  }

  /// Unregisters the current token from the API (best-effort).
  Future<void> stop() async {
    final token = _currentToken;
    _currentToken = null;
    await _tokenSub?.cancel();
    _tokenSub = null;

    if (token == null || _client == null) return;
    try {
      await _client!.mutate('''
        mutation UnregisterDeviceToken(\$token: String!) {
          unregisterDeviceToken(args: { token: \$token })
        }
      ''', variables: {'token': token});
    } catch (_) {
      // Best-effort.
    }
  }

  Future<void> dispose() async {
    await _tokenSub?.cancel();
    await _foregroundSub?.cancel();
    _tokenSub = null;
    _foregroundSub = null;
  }

  Future<void> _register(String token) async {
    final client = _client;
    if (client == null) return;

    final platform = _platformLabel();
    try {
      await client.mutate('''
        mutation RegisterDeviceToken(\$token: String!, \$platform: String!) {
          registerDeviceToken(args: { token: \$token, platform: \$platform })
        }
      ''', variables: {
        'token': token,
        'platform': platform,
      });
      _currentToken = token;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('registerDeviceToken failed: $e');
      }
    }
  }

  Future<void> _showForeground(PushMessage message) async {
    final title = message.title;
    final body = message.body;
    if (title == null && body == null) return;

    final budgetId = int.tryParse(message.data['budget_id'] ?? '') ?? 0;
    final periodStart = message.data['period_start'] ?? 'none';
    await _local.showNow(
      ImmediateNotification(
        id: _notificationId(budgetId, periodStart),
        title: title ?? 'Budget alert',
        body: body ?? '',
      ),
    );
  }

  static String _platformLabel() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.android:
        return 'android';
      default:
        return 'web';
    }
  }

  static int _notificationId(int budgetId, String periodKey) {
    var hash = 17;
    hash = 37 * hash + budgetId;
    hash = 37 * hash + periodKey.hashCode;
    return hash.abs() & 0x7fffffff;
  }
}

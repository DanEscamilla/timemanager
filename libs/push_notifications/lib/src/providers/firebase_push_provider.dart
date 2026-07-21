import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../models.dart';
import '../push_provider.dart';

/// Firebase Cloud Messaging implementation of [PushProvider].
///
/// Callers must ensure [Firebase.initializeApp] has run (or pass
/// [firebaseOptions] so this provider initializes Firebase itself).
///
/// Do not touch [FirebaseMessaging.instance] until after Firebase is
/// initialized — on web that throws a JS interop TypeError.
class FirebasePushProvider implements PushProvider {
  FirebasePushProvider({
    FirebaseOptions? firebaseOptions,
    FirebaseMessaging? messaging,
    this.vapidKey,
  })  : _firebaseOptions = firebaseOptions,
        _messagingOverride = messaging;

  final FirebaseOptions? _firebaseOptions;
  final FirebaseMessaging? _messagingOverride;

  /// Web Push certificate key from Firebase Console → Cloud Messaging.
  /// Required for [getToken] on web; ignored on native platforms.
  final String? vapidKey;

  FirebaseMessaging? _messaging;
  final _tokenRefreshController = StreamController<String>.broadcast();
  final _foregroundController = StreamController<PushMessage>.broadcast();
  final _openedController = StreamController<PushMessage>.broadcast();

  StreamSubscription<String>? _tokenSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;
  bool _initialized = false;

  FirebaseMessaging get _requireMessaging {
    final messaging = _messaging;
    if (messaging == null) {
      throw StateError('FirebasePushProvider.initialize must be called first');
    }
    return messaging;
  }

  @override
  Future<void> initialize() async {
    if (_initialized) return;

    if (Firebase.apps.isEmpty) {
      final options = _firebaseOptions;
      if (options != null) {
        await Firebase.initializeApp(options: options);
      } else {
        await Firebase.initializeApp();
      }
    }

    // Only resolve messaging after Firebase.initializeApp (web-safe).
    final messaging = _messagingOverride ?? FirebaseMessaging.instance;
    _messaging = messaging;

    _tokenSub = messaging.onTokenRefresh.listen(_tokenRefreshController.add);
    _foregroundSub = FirebaseMessaging.onMessage.listen((message) {
      _foregroundController.add(_mapMessage(message));
    });
    _openedSub = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _openedController.add(_mapMessage(message));
    });

    // getInitialMessage is unsupported / flaky on some web setups.
    try {
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        _openedController.add(_mapMessage(initial));
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('FirebasePushProvider.getInitialMessage failed: $e');
      }
    }

    _initialized = true;
  }

  @override
  Future<bool> requestPermission() async {
    final settings = await _requireMessaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    final status = settings.authorizationStatus;
    return status == AuthorizationStatus.authorized ||
        status == AuthorizationStatus.provisional;
  }

  @override
  Future<String?> getToken() async {
    try {
      return await _requireMessaging.getToken(
        vapidKey: kIsWeb ? vapidKey : null,
      );
    } catch (e) {
      if (kDebugMode) {
        debugPrint('FirebasePushProvider.getToken failed: $e');
      }
      return null;
    }
  }

  @override
  Stream<String> get onTokenRefresh => _tokenRefreshController.stream;

  @override
  Stream<PushMessage> get onForegroundMessage => _foregroundController.stream;

  @override
  Stream<PushMessage> get onMessageOpenedApp => _openedController.stream;

  /// Releases stream subscriptions (tests / hot-restart).
  Future<void> dispose() async {
    await _tokenSub?.cancel();
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    await _tokenRefreshController.close();
    await _foregroundController.close();
    await _openedController.close();
    _messaging = null;
    _initialized = false;
  }

  static PushMessage _mapMessage(RemoteMessage message) {
    final notification = message.notification;
    final data = <String, String>{};
    message.data.forEach((key, value) {
      data[key] = value?.toString() ?? '';
    });
    return PushMessage(
      title: notification?.title,
      body: notification?.body,
      data: data,
    );
  }
}

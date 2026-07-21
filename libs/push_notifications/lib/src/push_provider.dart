import 'models.dart';

/// Provider-agnostic push backend (FCM, OneSignal, etc.).
abstract class PushProvider {
  /// Initializes the underlying SDK / plugins.
  Future<void> initialize();

  /// Requests OS / browser notification permission.
  Future<bool> requestPermission();

  /// Current device push token, or null if unavailable.
  Future<String?> getToken();

  /// Emits a new token when the provider refreshes it.
  Stream<String> get onTokenRefresh;

  /// Messages received while the app is in the foreground.
  Stream<PushMessage> get onForegroundMessage;

  /// Messages that opened the app from background / terminated.
  Stream<PushMessage> get onMessageOpenedApp;
}

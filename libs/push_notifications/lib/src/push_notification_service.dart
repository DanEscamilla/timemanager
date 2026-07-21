import 'models.dart';
import 'push_notification_config.dart';
import 'push_provider.dart';

/// Registers for push and exposes token / message streams across product apps.
///
/// Domain policy (when to register with the API, how to display) stays in apps.
class PushNotificationService {
  PushNotificationService._();

  static final PushNotificationService instance = PushNotificationService._();

  PushNotificationConfig? _config;
  PushProvider? _provider;
  bool _initialized = false;

  PushNotificationConfig get config {
    final config = _config;
    if (config == null) {
      throw StateError(
        'PushNotificationService.ensureInitialized must be called first',
      );
    }
    return config;
  }

  PushProvider get _requireProvider {
    final provider = _provider;
    if (provider == null) {
      throw StateError(
        'PushNotificationService.ensureInitialized must be called first',
      );
    }
    return provider;
  }

  /// Stores [config] and initializes [provider] once.
  ///
  /// Propagates provider failures so callers can leave push disabled
  /// (e.g. web without Firebase ready) instead of treating init as success.
  Future<void> ensureInitialized({
    required PushNotificationConfig config,
    required PushProvider provider,
  }) async {
    if (_initialized) return;
    await provider.initialize();
    _config = config;
    _provider = provider;
    _initialized = true;
  }

  Future<bool> requestPermission() => _requireProvider.requestPermission();

  Future<String?> getToken() => _requireProvider.getToken();

  Stream<String> get onTokenRefresh => _requireProvider.onTokenRefresh;

  Stream<PushMessage> get onForegroundMessage =>
      _requireProvider.onForegroundMessage;

  Stream<PushMessage> get onMessageOpenedApp =>
      _requireProvider.onMessageOpenedApp;

  /// Test / hot-restart helper to clear singleton state.
  void resetForTest() {
    _config = null;
    _provider = null;
    _initialized = false;
  }
}

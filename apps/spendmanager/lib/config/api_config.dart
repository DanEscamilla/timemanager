import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Backend connection settings.
///
/// Defaults to localhost (`:3001` auth, `:3002` GraphQL). Override for cloud:
/// `--dart-define=AUTH_API_BASE_URL=https://auth.example.com`
/// `--dart-define=API_BASE_URL=https://api.example.com`
/// `--dart-define=IDLE_SESSION_TIMEOUT_MINUTES=30` (use `0` to disable)
class ApiConfig {
  static const int _authPort = 3001;
  static const int _apiPort = 3002;
  static const int _defaultIdleSessionTimeoutMinutes = 30;

  static const String _authApiBaseUrlOverride = String.fromEnvironment(
    'AUTH_API_BASE_URL',
  );
  static const String _apiBaseUrlOverride = String.fromEnvironment(
    'API_BASE_URL',
  );
  static const String _idleSessionTimeoutMinutesOverride =
      String.fromEnvironment(
    'IDLE_SESSION_TIMEOUT_MINUTES',
  );

  static String get _host {
    if (kIsWeb) return 'localhost';
    if (Platform.isAndroid) return '10.0.2.2';
    return 'localhost';
  }

  /// SuperTokens auth API (shared SSO hub).
  static String get authApiBaseUrl {
    if (_authApiBaseUrlOverride.isNotEmpty) return _authApiBaseUrlOverride;
    return 'http://$_host:$_authPort';
  }

  static String get authBasePath => '/auth';

  static String get graphqlEndpoint => '$apiBaseUrl/graphql';

  /// REST base for the GraphQL API host.
  static String get apiBaseUrl {
    if (_apiBaseUrlOverride.isNotEmpty) return _apiBaseUrlOverride;
    return 'http://$_host:$_apiPort';
  }

  /// OAuth redirect target after the provider callback (Flutter web / deep link).
  static String get oauthRedirectUri =>
      kIsWeb ? Uri.base.origin : 'spendmanager://auth/callback';

  /// Client-side idle logout duration. `Duration.zero` disables the monitor.
  static Duration get idleSessionTimeout {
    final raw = _idleSessionTimeoutMinutesOverride;
    final minutes = raw.isEmpty
        ? _defaultIdleSessionTimeoutMinutes
        : int.tryParse(raw) ?? _defaultIdleSessionTimeoutMinutes;
    if (minutes <= 0) return Duration.zero;
    return Duration(minutes: minutes);
  }
}

import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Backend connection settings.
///
/// Defaults to localhost (`:3001` auth, `:3000` GraphQL). Override for cloud:
/// `--dart-define=AUTH_API_BASE_URL=https://auth.example.com`
/// `--dart-define=API_BASE_URL=https://api.example.com`
///
/// Convenience: `DOMAIN=example.com nx run timemanager:build-macos` (etc.),
/// `config/cloud.dart-defines.json`, or IDE **timemanager (cloud)**.
class ApiConfig {
  static const int _authPort = 3001;
  static const int _apiPort = 3000;

  static const String _authApiBaseUrlOverride = String.fromEnvironment(
    'AUTH_API_BASE_URL',
  );
  static const String _apiBaseUrlOverride = String.fromEnvironment(
    'API_BASE_URL',
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

  static String get graphqlEndpoint => '${apiBaseUrl}/graphql';

  /// REST base for the GraphQL API host (e.g. asset upload at `/assets`).
  static String get apiBaseUrl {
    if (_apiBaseUrlOverride.isNotEmpty) return _apiBaseUrlOverride;
    return 'http://$_host:$_apiPort';
  }

  /// OAuth redirect target after the provider callback (Flutter web / deep link).
  static String get oauthRedirectUri =>
      kIsWeb ? Uri.base.origin : 'timemanager://auth/callback';
}

import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Backend connection settings for local development.
class ApiConfig {
  static const int _authPort = 3001;
  static const int _apiPort = 3000;

  static String get _host {
    if (kIsWeb) return 'localhost';
    if (Platform.isAndroid) return '10.0.2.2';
    return 'localhost';
  }

  /// SuperTokens auth API (shared SSO hub).
  static String get authApiBaseUrl => 'http://$_host:$_authPort';

  static String get authBasePath => '/auth';

  static String get graphqlEndpoint => 'http://$_host:$_apiPort/graphql';

  /// OAuth redirect target after the provider callback (Flutter web / deep link).
  static String get oauthRedirectUri =>
      kIsWeb ? Uri.base.origin : 'timemanager://auth/callback';
}

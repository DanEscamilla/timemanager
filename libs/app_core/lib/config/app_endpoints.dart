import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Shared backend connection settings for Flutter product apps.
///
/// Call [configure] once at app startup (before creating [AuthService] /
/// [GraphQLClient]). Apps typically wrap this in a thin `ApiConfig` that
/// supplies product-specific ports and OAuth schemes.
class AppEndpoints {
  AppEndpoints({
    required this.authApiBaseUrl,
    required this.apiBaseUrl,
    required this.oauthRedirectUri,
    this.authBasePath = '/auth',
    this.idleSessionTimeout = const Duration(minutes: 30),
  });

  /// Local-dev defaults with optional `--dart-define` overrides.
  factory AppEndpoints.local({
    required int apiPort,
    required String oauthNativeScheme,
    int authPort = 3001,
    int defaultIdleSessionTimeoutMinutes = 30,
  }) {
    const authOverride = String.fromEnvironment('AUTH_API_BASE_URL');
    const apiOverride = String.fromEnvironment('API_BASE_URL');
    const idleOverride = String.fromEnvironment('IDLE_SESSION_TIMEOUT_MINUTES');

    final host = _defaultHost;
    final authApiBaseUrl = authOverride.isNotEmpty
        ? authOverride
        : 'http://$host:$authPort';
    final apiBaseUrl =
        apiOverride.isNotEmpty ? apiOverride : 'http://$host:$apiPort';
    final oauthRedirectUri =
        kIsWeb ? Uri.base.origin : '$oauthNativeScheme://auth/callback';

    final minutes = idleOverride.isEmpty
        ? defaultIdleSessionTimeoutMinutes
        : int.tryParse(idleOverride) ?? defaultIdleSessionTimeoutMinutes;
    final idleSessionTimeout =
        minutes <= 0 ? Duration.zero : Duration(minutes: minutes);

    return AppEndpoints(
      authApiBaseUrl: authApiBaseUrl,
      apiBaseUrl: apiBaseUrl,
      oauthRedirectUri: oauthRedirectUri,
      idleSessionTimeout: idleSessionTimeout,
    );
  }

  static String get _defaultHost {
    if (kIsWeb) return 'localhost';
    if (Platform.isAndroid) return '10.0.2.2';
    return 'localhost';
  }

  static AppEndpoints? _instance;

  /// Configure the process-wide endpoints used by auth / GraphQL defaults.
  static void configure(AppEndpoints endpoints) {
    _instance = endpoints;
  }

  /// Currently configured endpoints.
  static AppEndpoints get instance {
    final current = _instance;
    if (current == null) {
      throw StateError(
        'AppEndpoints.configure() must be called before using AuthService / GraphQLClient defaults',
      );
    }
    return current;
  }

  static bool get isConfigured => _instance != null;

  /// Test helper to clear configuration between cases.
  static void resetForTest() {
    _instance = null;
  }

  final String authApiBaseUrl;
  final String apiBaseUrl;
  final String oauthRedirectUri;
  final String authBasePath;
  final Duration idleSessionTimeout;

  String get graphqlEndpoint => '$apiBaseUrl/graphql';
}

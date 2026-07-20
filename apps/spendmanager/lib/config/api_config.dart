import 'package:app_core/app_core.dart';

/// Backend connection settings for spendmanager.
///
/// Defaults to localhost (`:3001` auth, `:3002` GraphQL). Override for cloud:
/// `--dart-define=AUTH_API_BASE_URL=https://auth.example.com`
/// `--dart-define=API_BASE_URL=https://api.example.com`
/// `--dart-define=IDLE_SESSION_TIMEOUT_MINUTES=30` (use `0` to disable)
///
/// Call [ensureConfigured] once at startup (see `main.dart`).
class ApiConfig {
  static final AppEndpoints endpoints = AppEndpoints.local(
    apiPort: 3002,
    oauthNativeScheme: 'spendmanager',
  );

  /// Register [endpoints] as the process-wide [AppEndpoints.instance].
  static void ensureConfigured() => AppEndpoints.configure(endpoints);

  static String get authApiBaseUrl => endpoints.authApiBaseUrl;

  static String get authBasePath => endpoints.authBasePath;

  static String get graphqlEndpoint => endpoints.graphqlEndpoint;

  static String get apiBaseUrl => endpoints.apiBaseUrl;

  static String get oauthRedirectUri => endpoints.oauthRedirectUri;

  static Duration get idleSessionTimeout => endpoints.idleSessionTimeout;
}

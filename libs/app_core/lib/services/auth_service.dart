import 'dart:convert';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_endpoints.dart';
import 'auth_token_store.dart';
import 'session_token_store.dart';

enum AuthAction { signUp, signIn, oauth }

enum AuthErrorCode {
  failedStatus,
  noSessionToken,
  startOAuthFailed,
  authorisationUrlMissing,
  couldNotGetAuthorisationUrl,
  couldNotOpenLogin,
  raw,
}

class AuthException implements Exception {
  AuthException(this.message)
      : code = AuthErrorCode.raw,
        action = null,
        provider = null,
        status = null,
        statusCode = null;

  AuthException._({
    required this.code,
    required this.message,
    this.action,
    this.provider,
    this.status,
    this.statusCode,
  });

  factory AuthException.failedStatus({
    required AuthAction action,
    required String status,
  }) {
    return AuthException._(
      code: AuthErrorCode.failedStatus,
      action: action,
      status: status,
      message: '${_fallbackAction(action)} failed ($status)',
    );
  }

  factory AuthException.noSessionToken({required AuthAction action}) {
    return AuthException._(
      code: AuthErrorCode.noSessionToken,
      action: action,
      message:
          '${_fallbackAction(action)} succeeded but no session token was returned',
    );
  }

  factory AuthException.startOAuthFailed({
    required String provider,
    required int statusCode,
  }) {
    return AuthException._(
      code: AuthErrorCode.startOAuthFailed,
      provider: provider,
      statusCode: statusCode,
      message: 'Failed to start $provider login ($statusCode)',
    );
  }

  factory AuthException.authorisationUrlMissing() {
    return AuthException._(
      code: AuthErrorCode.authorisationUrlMissing,
      message: 'Authorisation URL missing from response',
    );
  }

  factory AuthException.couldNotGetAuthorisationUrl() {
    return AuthException._(
      code: AuthErrorCode.couldNotGetAuthorisationUrl,
      message: 'Could not get authorisation URL',
    );
  }

  factory AuthException.couldNotOpenLogin({required String provider}) {
    return AuthException._(
      code: AuthErrorCode.couldNotOpenLogin,
      provider: provider,
      message: 'Could not open $provider login',
    );
  }

  final AuthErrorCode code;
  final String message;
  final AuthAction? action;
  final String? provider;
  final String? status;
  final int? statusCode;

  static String _fallbackAction(AuthAction action) => switch (action) {
        AuthAction.signUp => 'Sign up',
        AuthAction.signIn => 'Sign in',
        AuthAction.oauth => 'OAuth sign in',
      };

  @override
  String toString() => message;
}

/// SuperTokens session client using header-based tokens (works on Flutter web).
///
/// `supertokens_flutter` is Android/iOS-only; this app targets Chrome, so we
/// talk to the FDI endpoints directly and persist tokens locally.
///
/// On web, [rememberDevice] chooses localStorage (SharedPreferences) vs
/// sessionStorage so unchecked sessions end when the browser closes.
class AuthService {
  AuthService({
    AppEndpoints? endpoints,
    http.Client? httpClient,
    AuthTokenStore? persistentStore,
    AuthTokenStore? sessionStore,
    bool? isWeb,
  })  : _endpoints = endpoints ?? AppEndpoints.instance,
        _http = httpClient ?? http.Client(),
        _persistentStoreOverride = persistentStore,
        _sessionStore =
            sessionStore ?? createSessionTokenStore(),
        _isWeb = isWeb ?? kIsWeb;

  final AppEndpoints _endpoints;
  final http.Client _http;
  final AuthTokenStore? _persistentStoreOverride;
  final AuthTokenStore _sessionStore;
  final bool _isWeb;

  SharedPreferences? _prefsCache;

  static const _accessTokenKey = 'st_access_token';
  static const _refreshTokenKey = 'st_refresh_token';
  static const _frontTokenKey = 'st_front_token';
  static const _oauthProviderKey = 'st_oauth_provider';
  static const _oauthPkceVerifierKey = 'st_oauth_pkce_verifier';
  static const _oauthRedirectUriKey = 'st_oauth_redirect_uri';
  static const _rememberDeviceKey = 'st_remember_device';

  static const oauthProviders = ['google', 'github', 'apple', 'twitter'];

  Future<bool> doesSessionExist() async {
    final token = await getAccessToken();
    return token != null && token.isNotEmpty;
  }

  Future<String?> getAccessToken() async {
    final store = await _activeTokenStore();
    return store.read(_accessTokenKey);
  }

  /// Whether tokens should survive browser restarts (web only).
  ///
  /// Native platforms always behave as remembered.
  Future<bool> getRememberDevice() async {
    if (!_isWeb) return true;
    final prefs = await _prefs();
    return prefs.getBool(_rememberDeviceKey) ?? false;
  }

  Future<void> setRememberDevice(bool remember) async {
    final prefs = await _prefs();
    await prefs.setBool(_rememberDeviceKey, _isWeb ? remember : true);
  }

  Future<void> signUp({
    required String email,
    required String password,
    bool rememberDevice = true,
  }) async {
    await setRememberDevice(rememberDevice);
    final response = await _postAuth(
      '/signup',
      rid: 'emailpassword',
      body: {
        'formFields': [
          {'id': 'email', 'value': email},
          {'id': 'password', 'value': password},
        ],
      },
    );
    await _handleAuthResponse(response, action: AuthAction.signUp);
  }

  Future<void> signIn({
    required String email,
    required String password,
    bool rememberDevice = true,
  }) async {
    await setRememberDevice(rememberDevice);
    final response = await _postAuth(
      '/signin',
      rid: 'emailpassword',
      body: {
        'formFields': [
          {'id': 'email', 'value': email},
          {'id': 'password', 'value': password},
        ],
      },
    );
    await _handleAuthResponse(response, action: AuthAction.signIn);
  }

  /// Start OAuth by opening the provider authorisation URL.
  ///
  /// On web, after redirect back to this app with `?code=&state=`, call
  /// [completeOAuthFromCurrentUri].
  Future<void> startOAuth(
    String thirdPartyId, {
    bool rememberDevice = true,
  }) async {
    await setRememberDevice(rememberDevice);
    final redirectUri = _endpoints.oauthRedirectUri;
    final uri = Uri.parse(
      '${_endpoints.authApiBaseUrl}${_endpoints.authBasePath}/authorisationurl',
    ).replace(queryParameters: {
      'thirdPartyId': thirdPartyId,
      'redirectURIOnProviderDashboard': redirectUri,
    });

    final response = await _http.get(
      uri,
      headers: {
        'rid': 'thirdparty',
        'fdi-version': '4.1',
        'st-auth-mode': 'header',
      },
    );

    if (response.statusCode != 200) {
      throw AuthException.startOAuthFailed(
        provider: thirdPartyId,
        statusCode: response.statusCode,
      );
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (body['status'] != 'OK') {
      final serverMessage = body['message']?.toString();
      if (serverMessage != null && serverMessage.isNotEmpty) {
        throw AuthException(serverMessage);
      }
      throw AuthException.couldNotGetAuthorisationUrl();
    }

    final url = body['urlWithQueryParams'] as String?;
    if (url == null || url.isEmpty) {
      throw AuthException.authorisationUrlMissing();
    }

    // Google (and others) require PKCE — SuperTokens returns the verifier
    // with the authorisation URL; we must send it back on /signinup.
    final prefs = await _prefs();
    await prefs.setString(_oauthProviderKey, thirdPartyId);
    await prefs.setString(_oauthRedirectUriKey, redirectUri);
    final pkce = body['pkceCodeVerifier'] as String?;
    if (pkce != null && pkce.isNotEmpty) {
      await prefs.setString(_oauthPkceVerifierKey, pkce);
    } else {
      await prefs.remove(_oauthPkceVerifierKey);
    }

    final launched = await launchUrl(
      Uri.parse(url),
      webOnlyWindowName: '_self',
      mode: LaunchMode.platformDefault,
    );
    if (!launched) {
      throw AuthException.couldNotOpenLogin(provider: thirdPartyId);
    }
  }

  /// Complete third-party sign-in using the current page query params (web).
  Future<bool> completeOAuthFromCurrentUri() async {
    final params = Uri.base.queryParameters;
    final code = params['code'];
    if (code == null || code.isEmpty) {
      return false;
    }

    final prefs = await _prefs();
    final thirdPartyId = prefs.getString(_oauthProviderKey) ??
        params['thirdPartyId'] ??
        'google';
    final redirectUri =
        prefs.getString(_oauthRedirectUriKey) ?? _endpoints.oauthRedirectUri;
    final pkceCodeVerifier = prefs.getString(_oauthPkceVerifierKey);

    final redirectURIInfo = <String, dynamic>{
      'redirectURIOnProviderDashboard': redirectUri,
      'redirectURIQueryParams': params,
    };
    if (pkceCodeVerifier != null && pkceCodeVerifier.isNotEmpty) {
      redirectURIInfo['pkceCodeVerifier'] = pkceCodeVerifier;
    }

    final response = await _postAuth(
      '/signinup',
      rid: 'thirdparty',
      body: {
        'thirdPartyId': thirdPartyId,
        'redirectURIInfo': redirectURIInfo,
      },
    );
    await _handleAuthResponse(response, action: AuthAction.oauth);
    await _clearOAuthState();
    return true;
  }

  Future<void> signOut() async {
    try {
      final accessToken = await getAccessToken();
      if (accessToken != null) {
        await _http.post(
          Uri.parse(
            '${_endpoints.authApiBaseUrl}${_endpoints.authBasePath}/signout',
          ),
          headers: {
            'Content-Type': 'application/json',
            'rid': 'session',
            'fdi-version': '4.1',
            'st-auth-mode': 'header',
            'Authorization': 'Bearer $accessToken',
          },
        );
      }
    } finally {
      await _clearTokens();
    }
  }

  /// Refresh the access token. Returns false if the session is dead.
  Future<bool> refreshSession() async {
    final store = await _activeTokenStore();
    final refreshToken = await store.read(_refreshTokenKey);
    if (refreshToken == null || refreshToken.isEmpty) {
      await _clearTokens();
      return false;
    }

    final response = await _http.post(
      Uri.parse(
        '${_endpoints.authApiBaseUrl}${_endpoints.authBasePath}/session/refresh',
      ),
      headers: {
        'Content-Type': 'application/json',
        'rid': 'session',
        'fdi-version': '4.1',
        'st-auth-mode': 'header',
        'Authorization': 'Bearer $refreshToken',
      },
    );

    if (response.statusCode == 401) {
      await _clearTokens();
      return false;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return false;
    }

    await _persistTokensFromHeaders(response.headers);
    return (await getAccessToken())?.isNotEmpty == true;
  }

  Future<http.Response> _postAuth(
    String path, {
    required String rid,
    required Map<String, dynamic> body,
  }) {
    return _http.post(
      Uri.parse('${_endpoints.authApiBaseUrl}${_endpoints.authBasePath}$path'),
      headers: {
        'Content-Type': 'application/json',
        'rid': rid,
        'fdi-version': '4.1',
        'st-auth-mode': 'header',
      },
      body: jsonEncode(body),
    );
  }

  Future<void> _handleAuthResponse(
    http.Response response, {
    required AuthAction action,
  }) async {
    Map<String, dynamic>? body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      body = null;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final serverMessage = body?['message']?.toString();
      if (serverMessage != null && serverMessage.isNotEmpty) {
        throw AuthException(serverMessage);
      }
      throw AuthException.failedStatus(
        action: action,
        status: '${response.statusCode}',
      );
    }

    final status = body?['status'] as String?;
    if (status != null && status != 'OK') {
      final formFields = body?['formFields'] as List<dynamic>?;
      if (formFields != null && formFields.isNotEmpty) {
        final messages = formFields
            .map((f) => (f as Map<String, dynamic>)['error']?.toString())
            .whereType<String>()
            .where((e) => e.isNotEmpty)
            .join('; ');
        if (messages.isNotEmpty) {
          throw AuthException(messages);
        }
      }
      final reason = body?['reason']?.toString() ?? body?['message']?.toString();
      if (reason != null && reason.isNotEmpty) {
        throw AuthException(reason);
      }
      throw AuthException.failedStatus(action: action, status: status);
    }

    await _persistTokensFromHeaders(response.headers);
    if ((await getAccessToken()) == null) {
      throw AuthException.noSessionToken(action: action);
    }
  }

  Future<void> _persistTokensFromHeaders(Map<String, String> headers) async {
    // http package lowercases header names.
    final access = headers['st-access-token'];
    final refresh = headers['st-refresh-token'];
    final front = headers['front-token'];

    final store = await _activeTokenStore();
    final other = await _inactiveTokenStore();
    for (final key in [_accessTokenKey, _refreshTokenKey, _frontTokenKey]) {
      await other.delete(key);
    }

    if (access != null && access.isNotEmpty) {
      await store.write(_accessTokenKey, access);
    }
    if (refresh != null && refresh.isNotEmpty) {
      await store.write(_refreshTokenKey, refresh);
    }
    if (front != null && front.isNotEmpty) {
      await store.write(_frontTokenKey, front);
    }
  }

  Future<void> _clearOAuthState() async {
    final prefs = await _prefs();
    await prefs.remove(_oauthProviderKey);
    await prefs.remove(_oauthPkceVerifierKey);
    await prefs.remove(_oauthRedirectUriKey);
  }

  Future<void> _clearTokens() async {
    final persistent = await _persistentStore();
    for (final key in [_accessTokenKey, _refreshTokenKey, _frontTokenKey]) {
      await persistent.delete(key);
      await _sessionStore.delete(key);
    }
    await _clearOAuthState();
  }

  Future<AuthTokenStore> _activeTokenStore() async {
    final remember = await getRememberDevice();
    if (_isWeb && !remember) return _sessionStore;
    return _persistentStore();
  }

  Future<AuthTokenStore> _inactiveTokenStore() async {
    final remember = await getRememberDevice();
    if (_isWeb && !remember) return _persistentStore();
    return _sessionStore;
  }

  Future<AuthTokenStore> _persistentStore() async {
    final override = _persistentStoreOverride;
    if (override != null) return override;
    return SharedPreferencesTokenStore(await _prefs());
  }

  Future<SharedPreferences> _prefs() async {
    return _prefsCache ??= await SharedPreferences.getInstance();
  }

  void dispose() => _http.close();
}

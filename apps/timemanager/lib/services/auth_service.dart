import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/api_config.dart';

class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// SuperTokens session client using header-based tokens (works on Flutter web).
///
/// `supertokens_flutter` is Android/iOS-only; this app targets Chrome, so we
/// talk to the FDI endpoints directly and persist tokens locally.
class AuthService {
  AuthService({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;

  static const _accessTokenKey = 'st_access_token';
  static const _refreshTokenKey = 'st_refresh_token';
  static const _frontTokenKey = 'st_front_token';
  static const _oauthProviderKey = 'st_oauth_provider';
  static const _oauthPkceVerifierKey = 'st_oauth_pkce_verifier';
  static const _oauthRedirectUriKey = 'st_oauth_redirect_uri';

  static const oauthProviders = ['google', 'github', 'apple', 'twitter'];

  Future<bool> doesSessionExist() async {
    final token = await getAccessToken();
    return token != null && token.isNotEmpty;
  }

  Future<String?> getAccessToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_accessTokenKey);
  }

  Future<void> signUp({
    required String email,
    required String password,
  }) async {
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
    await _handleAuthResponse(response, action: 'Sign up');
  }

  Future<void> signIn({
    required String email,
    required String password,
  }) async {
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
    await _handleAuthResponse(response, action: 'Sign in');
  }

  /// Start OAuth by opening the provider authorisation URL.
  ///
  /// On web, after redirect back to this app with `?code=&state=`, call
  /// [completeOAuthFromCurrentUri].
  Future<void> startOAuth(String thirdPartyId) async {
    final redirectUri = ApiConfig.oauthRedirectUri;
    final uri = Uri.parse(
      '${ApiConfig.authApiBaseUrl}${ApiConfig.authBasePath}/authorisationurl',
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
      throw AuthException(
        'Failed to start $thirdPartyId login (${response.statusCode})',
      );
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (body['status'] != 'OK') {
      throw AuthException(
        body['message']?.toString() ?? 'Could not get authorisation URL',
      );
    }

    final url = body['urlWithQueryParams'] as String?;
    if (url == null || url.isEmpty) {
      throw AuthException('Authorisation URL missing from response');
    }

    // Google (and others) require PKCE — SuperTokens returns the verifier
    // with the authorisation URL; we must send it back on /signinup.
    final prefs = await SharedPreferences.getInstance();
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
      throw AuthException('Could not open $thirdPartyId login');
    }
  }

  /// Complete third-party sign-in using the current page query params (web).
  Future<bool> completeOAuthFromCurrentUri() async {
    final params = Uri.base.queryParameters;
    final code = params['code'];
    if (code == null || code.isEmpty) {
      return false;
    }

    final prefs = await SharedPreferences.getInstance();
    final thirdPartyId = prefs.getString(_oauthProviderKey) ??
        params['thirdPartyId'] ??
        'google';
    final redirectUri =
        prefs.getString(_oauthRedirectUriKey) ?? ApiConfig.oauthRedirectUri;
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
    await _handleAuthResponse(response, action: 'OAuth sign in');
    await _clearOAuthState();
    return true;
  }

  Future<void> signOut() async {
    try {
      final accessToken = await getAccessToken();
      if (accessToken != null) {
        await _http.post(
          Uri.parse(
            '${ApiConfig.authApiBaseUrl}${ApiConfig.authBasePath}/signout',
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
    final prefs = await SharedPreferences.getInstance();
    final refreshToken = prefs.getString(_refreshTokenKey);
    if (refreshToken == null || refreshToken.isEmpty) {
      await _clearTokens();
      return false;
    }

    final response = await _http.post(
      Uri.parse(
        '${ApiConfig.authApiBaseUrl}${ApiConfig.authBasePath}/session/refresh',
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
      Uri.parse('${ApiConfig.authApiBaseUrl}${ApiConfig.authBasePath}$path'),
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
    required String action,
  }) async {
    Map<String, dynamic>? body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      body = null;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AuthException(
        body?['message']?.toString() ??
            '$action failed (${response.statusCode})',
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
      throw AuthException(
        body?['reason']?.toString() ??
            body?['message']?.toString() ??
            '$action failed ($status)',
      );
    }

    await _persistTokensFromHeaders(response.headers);
    if ((await getAccessToken()) == null) {
      throw AuthException('$action succeeded but no session token was returned');
    }
  }

  Future<void> _persistTokensFromHeaders(Map<String, String> headers) async {
    // http package lowercases header names.
    final access = headers['st-access-token'];
    final refresh = headers['st-refresh-token'];
    final front = headers['front-token'];

    final prefs = await SharedPreferences.getInstance();
    if (access != null && access.isNotEmpty) {
      await prefs.setString(_accessTokenKey, access);
    }
    if (refresh != null && refresh.isNotEmpty) {
      await prefs.setString(_refreshTokenKey, refresh);
    }
    if (front != null && front.isNotEmpty) {
      await prefs.setString(_frontTokenKey, front);
    }
  }

  Future<void> _clearOAuthState() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_oauthProviderKey);
    await prefs.remove(_oauthPkceVerifierKey);
    await prefs.remove(_oauthRedirectUriKey);
  }

  Future<void> _clearTokens() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_accessTokenKey);
    await prefs.remove(_refreshTokenKey);
    await prefs.remove(_frontTokenKey);
    await _clearOAuthState();
  }

  void dispose() => _http.close();
}

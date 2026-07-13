import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import '../l10n/app_localizations.dart';
import 'auth_service.dart';

enum GraphQLErrorCode {
  notSignedIn,
  sessionExpired,
  requestFailed,
  noData,
  raw,
}

class GraphQLException implements Exception {
  GraphQLException(
    this.message, {
    this.errors,
    this.statusCode,
    this.code = GraphQLErrorCode.raw,
    this.responseBody,
  });

  factory GraphQLException.notSignedIn() => GraphQLException(
        'Not signed in',
        statusCode: 401,
        code: GraphQLErrorCode.notSignedIn,
      );

  factory GraphQLException.sessionExpired() => GraphQLException(
        'Session expired. Please sign in again.',
        statusCode: 401,
        code: GraphQLErrorCode.sessionExpired,
      );

  factory GraphQLException.requestFailed({
    required int statusCode,
    required String body,
  }) =>
      GraphQLException(
        'Request failed ($statusCode): $body',
        statusCode: statusCode,
        code: GraphQLErrorCode.requestFailed,
        responseBody: body,
      );

  factory GraphQLException.noData() => GraphQLException(
        'No data in GraphQL response',
        code: GraphQLErrorCode.noData,
      );

  final String message;
  final List<dynamic>? errors;
  final int? statusCode;
  final GraphQLErrorCode code;
  final String? responseBody;

  bool get isUnauthorized => statusCode == 401;

  String localize(AppLocalizations l10n) => switch (code) {
        GraphQLErrorCode.notSignedIn => l10n.errorNotSignedIn,
        GraphQLErrorCode.sessionExpired => l10n.errorSessionExpired,
        GraphQLErrorCode.requestFailed => l10n.errorRequestFailed(
            statusCode ?? 0,
            responseBody ?? '',
          ),
        GraphQLErrorCode.noData => l10n.errorNoGraphQlData,
        GraphQLErrorCode.raw => message,
      };

  @override
  String toString() => message;
}

typedef UnauthorizedHandler = Future<void> Function();

class GraphQLClient {
  GraphQLClient({
    http.Client? httpClient,
    String? endpoint,
    AuthService? authService,
    this.onUnauthorized,
  })  : _http = httpClient ?? http.Client(),
        _endpoint = endpoint ?? ApiConfig.graphqlEndpoint,
        _auth = authService ?? AuthService();

  final http.Client _http;
  final String _endpoint;
  final AuthService _auth;
  final UnauthorizedHandler? onUnauthorized;

  Future<Map<String, dynamic>> query(
    String document, {
    Map<String, dynamic>? variables,
  }) {
    return _execute(document, variables: variables);
  }

  Future<Map<String, dynamic>> mutate(
    String document, {
    Map<String, dynamic>? variables,
  }) {
    return _execute(document, variables: variables);
  }

  Future<Map<String, dynamic>> _execute(
    String document, {
    Map<String, dynamic>? variables,
    bool didRefresh = false,
  }) async {
    final accessToken = await _auth.getAccessToken();
    if (accessToken == null || accessToken.isEmpty) {
      await onUnauthorized?.call();
      throw GraphQLException.notSignedIn();
    }

    final response = await _http.post(
      Uri.parse(_endpoint),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $accessToken',
        'st-auth-mode': 'header',
      },
      body: jsonEncode({
        'query': document,
        if (variables != null) 'variables': variables,
      }),
    );

    if (response.statusCode == 401) {
      if (!didRefresh) {
        final refreshed = await _auth.refreshSession();
        if (refreshed) {
          return _execute(
            document,
            variables: variables,
            didRefresh: true,
          );
        }
      }
      await onUnauthorized?.call();
      throw GraphQLException.sessionExpired();
    }

    if (response.statusCode != 200) {
      throw GraphQLException.requestFailed(
        statusCode: response.statusCode,
        body: response.body,
      );
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final errors = body['errors'];
    if (errors != null && errors is List && errors.isNotEmpty) {
      final message = errors
          .map((e) => (e as Map<String, dynamic>)['message'])
          .join('; ');
      throw GraphQLException(message, errors: errors);
    }

    final data = body['data'];
    if (data == null || data is! Map<String, dynamic>) {
      throw GraphQLException.noData();
    }

    return data;
  }

  void dispose() => _http.close();
}

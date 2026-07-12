import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'auth_service.dart';

class GraphQLException implements Exception {
  GraphQLException(this.message, {this.errors, this.statusCode});

  final String message;
  final List<dynamic>? errors;
  final int? statusCode;

  bool get isUnauthorized => statusCode == 401;

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
      throw GraphQLException('Not signed in', statusCode: 401);
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
      throw GraphQLException(
        'Session expired. Please sign in again.',
        statusCode: 401,
      );
    }

    if (response.statusCode != 200) {
      throw GraphQLException(
        'Request failed (${response.statusCode}): ${response.body}',
        statusCode: response.statusCode,
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
      throw GraphQLException('No data in GraphQL response');
    }

    return data;
  }

  void dispose() => _http.close();
}

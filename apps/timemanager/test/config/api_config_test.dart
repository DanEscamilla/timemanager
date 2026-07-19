import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/config/api_config.dart';

void main() {
  test('ApiConfig falls back to localhost ports without dart-defines', () {
    // fromEnvironment defaults are empty in tests unless --dart-define is passed.
    expect(ApiConfig.authApiBaseUrl, contains(':3001'));
    expect(ApiConfig.apiBaseUrl, contains(':3000'));
    expect(ApiConfig.graphqlEndpoint, endsWith('/graphql'));
  });
}

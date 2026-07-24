import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/config/api_config.dart';

void main() {
  test('ApiConfig falls back to localhost ports without dart-defines', () {
    expect(ApiConfig.authApiBaseUrl, contains(':3001'));
    expect(ApiConfig.apiBaseUrl, contains(':3002'));
    expect(ApiConfig.graphqlEndpoint, endsWith('/graphql'));
    expect(ApiConfig.mailboxApiBaseUrl, contains(':3003'));
    expect(ApiConfig.mailboxGraphqlEndpoint, endsWith('/graphql'));
  });

  test('ApiConfig idleSessionTimeout defaults to 30 minutes', () {
    expect(ApiConfig.idleSessionTimeout, const Duration(minutes: 30));
  });
}

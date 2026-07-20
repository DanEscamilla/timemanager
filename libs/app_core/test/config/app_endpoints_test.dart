import 'package:app_core/app_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    AppEndpoints.configure(
      AppEndpoints.local(apiPort: 3000, oauthNativeScheme: 'test'),
    );
  });

  tearDown(AppEndpoints.resetForTest);

  test('AppEndpoints.local defaults auth to :3001 and idle to 30m', () {
    final endpoints = AppEndpoints.instance;
    expect(endpoints.authApiBaseUrl, contains(':3001'));
    expect(endpoints.apiBaseUrl, contains(':3000'));
    expect(endpoints.graphqlEndpoint, endsWith('/graphql'));
    expect(endpoints.idleSessionTimeout, const Duration(minutes: 30));
  });
}

import 'dart:convert';

import 'package:app_core/app_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppEndpoints.configure(
      AppEndpoints(
        authApiBaseUrl: 'http://localhost:3001',
        apiBaseUrl: 'http://localhost:3000',
        oauthRedirectUri: 'http://localhost',
      ),
    );
  });

  tearDown(AppEndpoints.resetForTest);

  test('remember on web writes tokens to persistent store only', () async {
    final persistent = MemoryTokenStore();
    final session = MemoryTokenStore();
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({'status': 'OK'}),
        200,
        headers: {
          'st-access-token': 'access-persistent',
          'st-refresh-token': 'refresh-persistent',
          'front-token': 'front-persistent',
        },
      );
    });

    final auth = AuthService(
      httpClient: client,
      persistentStore: persistent,
      sessionStore: session,
      isWeb: true,
    );

    await auth.signIn(
      email: 'a@b.com',
      password: 'password1',
      rememberDevice: true,
    );

    expect(await persistent.read('st_access_token'), 'access-persistent');
    expect(await session.read('st_access_token'), isNull);
    expect(await auth.getRememberDevice(), isTrue);
    expect(await auth.getAccessToken(), 'access-persistent');
  });

  test('remember off on web writes tokens to session store only', () async {
    final persistent = MemoryTokenStore();
    final session = MemoryTokenStore();
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({'status': 'OK'}),
        200,
        headers: {
          'st-access-token': 'access-session',
          'st-refresh-token': 'refresh-session',
          'front-token': 'front-session',
        },
      );
    });

    final auth = AuthService(
      httpClient: client,
      persistentStore: persistent,
      sessionStore: session,
      isWeb: true,
    );

    await auth.signIn(
      email: 'a@b.com',
      password: 'password1',
      rememberDevice: false,
    );

    expect(await session.read('st_access_token'), 'access-session');
    expect(await persistent.read('st_access_token'), isNull);
    expect(await auth.getRememberDevice(), isFalse);
    expect(await auth.getAccessToken(), 'access-session');
  });

  test('signOut clears tokens from both stores', () async {
    final persistent = MemoryTokenStore();
    final session = MemoryTokenStore();
    await persistent.write('st_access_token', 'a');
    await session.write('st_access_token', 'b');

    final client = MockClient((request) async {
      return http.Response('{}', 200);
    });

    final auth = AuthService(
      httpClient: client,
      persistentStore: persistent,
      sessionStore: session,
      isWeb: true,
    );
    await auth.setRememberDevice(false);
    await session.write('st_access_token', 'session-token');

    await auth.signOut();

    expect(await persistent.read('st_access_token'), isNull);
    expect(await session.read('st_access_token'), isNull);
  });

  test('native always remembers regardless of flag', () async {
    final persistent = MemoryTokenStore();
    final session = MemoryTokenStore();
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({'status': 'OK'}),
        200,
        headers: {
          'st-access-token': 'access-native',
          'st-refresh-token': 'refresh-native',
        },
      );
    });

    final auth = AuthService(
      httpClient: client,
      persistentStore: persistent,
      sessionStore: session,
      isWeb: false,
    );

    await auth.signIn(
      email: 'a@b.com',
      password: 'password1',
      rememberDevice: false,
    );

    expect(await auth.getRememberDevice(), isTrue);
    expect(await persistent.read('st_access_token'), 'access-native');
    expect(await session.read('st_access_token'), isNull);
  });
}

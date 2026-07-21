import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:push_notifications/push_notifications.dart';

class _FakePushProvider implements PushProvider {
  final _tokenController = StreamController<String>.broadcast();
  final _foregroundController = StreamController<PushMessage>.broadcast();
  final _openedController = StreamController<PushMessage>.broadcast();

  String? token = 'fake-token';
  bool permissionGranted = true;
  bool initializeCalled = false;

  @override
  Future<void> initialize() async {
    initializeCalled = true;
  }

  @override
  Future<bool> requestPermission() async => permissionGranted;

  @override
  Future<String?> getToken() async => token;

  @override
  Stream<String> get onTokenRefresh => _tokenController.stream;

  @override
  Stream<PushMessage> get onForegroundMessage => _foregroundController.stream;

  @override
  Stream<PushMessage> get onMessageOpenedApp => _openedController.stream;

  void emitToken(String value) => _tokenController.add(value);

  void emitForeground(PushMessage message) =>
      _foregroundController.add(message);

  Future<void> dispose() async {
    await _tokenController.close();
    await _foregroundController.close();
    await _openedController.close();
  }
}

void main() {
  tearDown(() {
    PushNotificationService.instance.resetForTest();
  });

  test('PushMessage equality compares title, body, and data', () {
    const a = PushMessage(
      title: 'T',
      body: 'B',
      data: {'k': 'v'},
    );
    const b = PushMessage(
      title: 'T',
      body: 'B',
      data: {'k': 'v'},
    );
    const c = PushMessage(
      title: 'T',
      body: 'Other',
      data: {'k': 'v'},
    );
    expect(a, equals(b));
    expect(a, isNot(equals(c)));
  });

  test('PushNotificationService delegates to provider', () async {
    final fake = _FakePushProvider();
    final service = PushNotificationService.instance;

    await service.ensureInitialized(
      config: const PushNotificationConfig(appId: 'spendmanager'),
      provider: fake,
    );

    expect(fake.initializeCalled, isTrue);
    expect(service.config.appId, 'spendmanager');
    expect(await service.requestPermission(), isTrue);
    expect(await service.getToken(), 'fake-token');

    final refreshed = service.onTokenRefresh.first;
    fake.emitToken('new-token');
    expect(await refreshed, 'new-token');

    final foreground = service.onForegroundMessage.first;
    const message = PushMessage(title: 'Alert', body: 'Budget hit');
    fake.emitForeground(message);
    expect(await foreground, message);

    await fake.dispose();
  });

  test('ensureInitialized throws when used before init', () {
    expect(
      () => PushNotificationService.instance.config,
      throwsStateError,
    );
  });

  test('ensureInitialized propagates provider failures', () async {
    final service = PushNotificationService.instance;
    await expectLater(
      service.ensureInitialized(
        config: const PushNotificationConfig(appId: 'spendmanager'),
        provider: _ThrowingPushProvider(),
      ),
      throwsA(isA<StateError>()),
    );
    expect(
      () => service.config,
      throwsStateError,
    );
  });
}

class _ThrowingPushProvider implements PushProvider {
  @override
  Future<void> initialize() async {
    throw StateError('firebase unavailable');
  }

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<String?> getToken() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream.empty();

  @override
  Stream<PushMessage> get onForegroundMessage => const Stream.empty();

  @override
  Stream<PushMessage> get onMessageOpenedApp => const Stream.empty();
}

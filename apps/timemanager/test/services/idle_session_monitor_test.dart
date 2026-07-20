import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/services/idle_session_monitor.dart';

void main() {
  test('does not start when timeout is zero', () {
    var idleCount = 0;
    final monitor = IdleSessionMonitor(
      timeout: Duration.zero,
      onIdle: () => idleCount++,
    );

    monitor.start();
    expect(monitor.isActive, isFalse);
    expect(idleCount, 0);
  });

  test('fires onIdle once after timeout without activity', () async {
    late void Function() fire;
    var idleCount = 0;

    final monitor = IdleSessionMonitor(
      timeout: const Duration(minutes: 1),
      onIdle: () => idleCount++,
      createTimer: (duration, callback) {
        fire = callback;
        return Timer(const Duration(days: 1), () {});
      },
    );

    monitor.start();
    expect(monitor.isActive, isTrue);
    fire();
    await Future<void>.delayed(Duration.zero);
    expect(idleCount, 1);
    expect(monitor.isActive, isFalse);

    fire();
    await Future<void>.delayed(Duration.zero);
    expect(idleCount, 1);
  });

  test('recordActivity resets the timer', () async {
    final callbacks = <void Function()>[];
    var createCount = 0;
    var idleCount = 0;

    final monitor = IdleSessionMonitor(
      timeout: const Duration(minutes: 30),
      onIdle: () => idleCount++,
      createTimer: (duration, callback) {
        createCount++;
        callbacks.add(callback);
        return Timer(const Duration(days: 1), () {});
      },
    );

    monitor.start();
    expect(createCount, 1);

    monitor.recordActivity();
    expect(createCount, 2);

    // Stale timer callback must be ignored after reset.
    callbacks.first();
    await Future<void>.delayed(Duration.zero);
    expect(idleCount, 0);

    callbacks.last();
    await Future<void>.delayed(Duration.zero);
    expect(idleCount, 1);
  });
}

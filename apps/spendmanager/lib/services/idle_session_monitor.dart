import 'dart:async';

/// Signs the user out after [timeout] with no [recordActivity] calls.
///
/// Disabled when [timeout] is [Duration.zero].
class IdleSessionMonitor {
  IdleSessionMonitor({
    required this.timeout,
    required this.onIdle,
    Timer Function(Duration duration, void Function() callback)? createTimer,
  }) : _createTimer = createTimer ?? Timer.new;

  final Duration timeout;
  final FutureOr<void> Function() onIdle;
  final Timer Function(Duration duration, void Function() callback)
      _createTimer;

  Timer? _timer;
  bool _active = false;
  bool _firing = false;
  int _generation = 0;

  bool get isActive => _active;

  void start() {
    if (timeout == Duration.zero) return;
    _active = true;
    _reset();
  }

  void stop() {
    _active = false;
    _generation++;
    _timer?.cancel();
    _timer = null;
  }

  void recordActivity() {
    if (!_active) return;
    _reset();
  }

  void _reset() {
    _timer?.cancel();
    final generation = ++_generation;
    _timer = _createTimer(timeout, () {
      if (generation != _generation) return;
      unawaited(_handleIdle());
    });
  }

  Future<void> _handleIdle() async {
    if (!_active || _firing) return;
    _firing = true;
    try {
      await onIdle();
    } finally {
      _firing = false;
      stop();
    }
  }
}

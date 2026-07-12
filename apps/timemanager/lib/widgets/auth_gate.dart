import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';

/// Routes to login or the app based on SuperTokens session presence.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key, this.authService});

  final AuthService? authService;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final AuthService _auth = widget.authService ?? AuthService();
  late Future<bool> _sessionFuture;

  @override
  void initState() {
    super.initState();
    _sessionFuture = _bootstrap();
  }

  Future<bool> _bootstrap() async {
    // Complete OAuth redirect if present (Flutter web).
    try {
      final completed = await _auth.completeOAuthFromCurrentUri();
      if (completed) return true;
    } catch (_) {
      // Fall through to normal session check; login screen can show errors.
    }
    return _auth.doesSessionExist();
  }

  void _onAuthenticated() {
    setState(() {
      _sessionFuture = Future.value(true);
    });
  }

  Future<void> _onSignedOut() async {
    await _auth.signOut();
    if (!mounted) return;
    setState(() {
      _sessionFuture = Future.value(false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _sessionFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final signedIn = snapshot.data == true;
        if (!signedIn) {
          return LoginScreen(
            authService: _auth,
            onAuthenticated: _onAuthenticated,
          );
        }

        return HomeScreen(
          authService: _auth,
          onSignedOut: _onSignedOut,
        );
      },
    );
  }
}

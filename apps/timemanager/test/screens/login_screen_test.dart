import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/l10n/app_localizations.dart';
import 'package:timemanager/screens/login_screen.dart';
import 'package:timemanager/services/auth_service.dart';
import 'package:design_system/design_system.dart';

class _FakeAuthService extends AuthService {
  @override
  Future<bool> doesSessionExist() async => false;

  @override
  Future<bool> completeOAuthFromCurrentUri() async => false;

  @override
  Future<void> signOut() async {}
}

void main() {
  Future<void> pumpLogin(
    WidgetTester tester, {
    bool? showRememberDevice,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildLightTheme(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: LoginScreen(
          authService: _FakeAuthService(),
          onAuthenticated: () {},
          showRememberDevice: showRememberDevice,
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('wires l10n into LoginView', (WidgetTester tester) async {
    await pumpLogin(tester);

    expect(find.byType(LoginView), findsOneWidget);
    final l10n = AppLocalizations.of(
      tester.element(find.byType(LoginScreen)),
    );
    expect(find.text(l10n.appTitle), findsOneWidget);
    expect(find.text(l10n.loginSignInContinue), findsOneWidget);
  });

  testWidgets('passes showRememberDevice through to LoginView', (
    WidgetTester tester,
  ) async {
    await pumpLogin(tester, showRememberDevice: true);

    final l10n = AppLocalizations.of(
      tester.element(find.byType(LoginScreen)),
    );
    expect(find.text(l10n.loginRememberDevice), findsOneWidget);
  });
}

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
    Size size = const Size(390, 844),
    double viewInsetBottom = 0,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = FakeViewPadding(bottom: viewInsetBottom);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildLightTheme(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: LoginScreen(
          authService: _FakeAuthService(),
          onAuthenticated: () {},
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('login form sits on scaffold without a card surface', (
    WidgetTester tester,
  ) async {
    await pumpLogin(tester);

    expect(find.byType(AppCard), findsNothing);
    expect(find.byType(Card), findsNothing);

    final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    final theme = Theme.of(tester.element(find.byType(LoginScreen)));
    expect(scaffold.backgroundColor ?? theme.scaffoldBackgroundColor,
        theme.colorScheme.surface);
  });

  testWidgets('does not overflow when virtual keyboard is open', (
    WidgetTester tester,
  ) async {
    // Short viewport with a tall keyboard inset (typical phone + keyboard).
    await pumpLogin(
      tester,
      size: const Size(390, 400),
      viewInsetBottom: 300,
    );

    expect(tester.takeException(), isNull);
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(2));
  });

  testWidgets('password field toggles visibility', (WidgetTester tester) async {
    await pumpLogin(tester);

    EditableText passwordEditable() =>
        tester.widget<EditableText>(find.byType(EditableText).last);

    expect(passwordEditable().obscureText, isTrue);
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);

    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pump();

    expect(passwordEditable().obscureText, isFalse);
    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);

    await tester.tap(find.byIcon(Icons.visibility_off_outlined));
    await tester.pump();

    expect(passwordEditable().obscureText, isTrue);
  });
}

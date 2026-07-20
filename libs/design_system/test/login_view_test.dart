import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

LoginViewConfig _testConfig({
  bool showRememberDevice = false,
  bool allowSignUp = true,
  List<LoginOAuthProvider> oauthProviders = const [],
}) {
  return LoginViewConfig(
    title: 'Test App',
    createAccountSubtitle: 'Create an account',
    signInSubtitle: 'Sign in to continue',
    emailLabel: 'Email',
    emailRequiredError: 'Email is required',
    emailInvalidError: 'Enter a valid email',
    passwordLabel: 'Password',
    passwordRequiredError: 'Password is required',
    passwordTooShortError: 'Use at least 8 characters',
    showPasswordTooltip: 'Show password',
    hidePasswordTooltip: 'Hide password',
    rememberDeviceLabel: 'Remember this device',
    signUpLabel: 'Sign up',
    signInLabel: 'Sign in',
    alreadyHaveAccountLabel: 'Already have an account? Sign in',
    needAccountLabel: 'Need an account? Sign up',
    orContinueWithLabel: 'Or continue with',
    oauthProviders: oauthProviders,
    showRememberDevice: showRememberDevice,
    allowSignUp: allowSignUp,
  );
}

void main() {
  Future<void> pumpLogin(
    WidgetTester tester, {
    Size size = const Size(390, 844),
    double viewInsetBottom = 0,
    LoginViewConfig? config,
    Future<void> Function({
      required String email,
      required String password,
      required bool rememberDevice,
      required bool isSignUp,
    })? onEmailPassword,
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
        home: LoginView(
          config: config ?? _testConfig(),
          onEmailPassword: onEmailPassword ??
              ({
                required email,
                required password,
                required rememberDevice,
                required isSignUp,
              }) async {},
          onSuccess: () {},
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
    final theme = Theme.of(tester.element(find.byType(LoginView)));
    expect(scaffold.backgroundColor ?? theme.scaffoldBackgroundColor,
        theme.colorScheme.surface);
  });

  testWidgets('does not overflow when virtual keyboard is open', (
    WidgetTester tester,
  ) async {
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

  testWidgets('remember device checkbox appears when enabled', (
    WidgetTester tester,
  ) async {
    await pumpLogin(
      tester,
      config: _testConfig(showRememberDevice: true),
    );

    expect(find.text('Remember this device'), findsOneWidget);
    expect(find.byType(CheckboxListTile), findsOneWidget);

    final tile = tester.widget<CheckboxListTile>(find.byType(CheckboxListTile));
    expect(tile.value, isFalse);

    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();

    expect(
      tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
      isTrue,
    );
  });

  testWidgets('remember device checkbox hidden when disabled', (
    WidgetTester tester,
  ) async {
    await pumpLogin(
      tester,
      config: _testConfig(showRememberDevice: false),
    );

    expect(find.byType(CheckboxListTile), findsNothing);
  });

  testWidgets('hides sign-up toggle when allowSignUp is false', (
    WidgetTester tester,
  ) async {
    await pumpLogin(
      tester,
      config: _testConfig(allowSignUp: false),
    );

    expect(find.text('Need an account? Sign up'), findsNothing);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('shows oauth buttons when providers configured', (
    WidgetTester tester,
  ) async {
    await pumpLogin(
      tester,
      config: _testConfig(
        oauthProviders: const [
          LoginOAuthProvider(id: 'google', label: 'Google'),
        ],
      ),
    );

    expect(find.text('Or continue with'), findsOneWidget);
    expect(find.text('Google'), findsOneWidget);
  });
}

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../services/auth_service.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({
    super.key,
    required this.authService,
    required this.onAuthenticated,
    this.showRememberDevice,
  });

  final AuthService authService;
  final VoidCallback onAuthenticated;
  final bool? showRememberDevice;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return LoginView(
      config: LoginViewConfig(
        title: l10n.appTitle,
        createAccountSubtitle: l10n.loginCreateAccount,
        signInSubtitle: l10n.loginSignInContinue,
        emailLabel: l10n.loginEmail,
        emailRequiredError: l10n.loginEmailRequired,
        emailInvalidError: l10n.loginEmailInvalid,
        passwordLabel: l10n.loginPassword,
        passwordRequiredError: l10n.loginPasswordRequired,
        passwordTooShortError: l10n.loginPasswordTooShort,
        showPasswordTooltip: l10n.loginShowPassword,
        hidePasswordTooltip: l10n.loginHidePassword,
        rememberDeviceLabel: l10n.loginRememberDevice,
        signUpLabel: l10n.loginSignUp,
        signInLabel: l10n.loginSignIn,
        alreadyHaveAccountLabel: l10n.loginAlreadyHaveAccount,
        needAccountLabel: l10n.loginNeedAccount,
        orContinueWithLabel: l10n.loginOrContinueWith,
        oauthProviders: [
          for (final id in AuthService.oauthProviders)
            LoginOAuthProvider(id: id, label: _providerLabel(id, l10n)),
        ],
        showRememberDevice: showRememberDevice ?? kIsWeb,
      ),
      onEmailPassword: ({
        required email,
        required password,
        required rememberDevice,
        required isSignUp,
      }) async {
        if (isSignUp) {
          await authService.signUp(
            email: email,
            password: password,
            rememberDevice: rememberDevice,
          );
        } else {
          await authService.signIn(
            email: email,
            password: password,
            rememberDevice: rememberDevice,
          );
        }
      },
      onOAuth: ({
        required providerId,
        required rememberDevice,
      }) {
        return authService.startOAuth(
          providerId,
          rememberDevice: rememberDevice,
        );
      },
      formatError: (error) {
        if (error is AuthException) {
          return error.localize(l10n);
        }
        return error.toString();
      },
      onSuccess: onAuthenticated,
    );
  }

  static String _providerLabel(String provider, AppLocalizations l10n) {
    switch (provider) {
      case 'google':
        return l10n.providerGoogle;
      case 'github':
        return l10n.providerGitHub;
      case 'apple':
        return l10n.providerApple;
      case 'twitter':
        return l10n.providerTwitter;
      default:
        return provider;
    }
  }
}

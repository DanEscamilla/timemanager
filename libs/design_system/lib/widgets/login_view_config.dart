/// Copy and knobs for [LoginView]. Callers supply localized strings.
class LoginViewConfig {
  const LoginViewConfig({
    required this.title,
    required this.createAccountSubtitle,
    required this.signInSubtitle,
    required this.emailLabel,
    required this.emailRequiredError,
    required this.emailInvalidError,
    required this.passwordLabel,
    required this.passwordRequiredError,
    required this.passwordTooShortError,
    required this.showPasswordTooltip,
    required this.hidePasswordTooltip,
    required this.rememberDeviceLabel,
    required this.signUpLabel,
    required this.signInLabel,
    required this.alreadyHaveAccountLabel,
    required this.needAccountLabel,
    required this.orContinueWithLabel,
    this.oauthProviders = const [],
    this.showRememberDevice = false,
    this.allowSignUp = true,
    this.minPasswordLength = 8,
    this.maxFormWidth = 420,
  });

  final String title;
  final String createAccountSubtitle;
  final String signInSubtitle;
  final String emailLabel;
  final String emailRequiredError;
  final String emailInvalidError;
  final String passwordLabel;
  final String passwordRequiredError;
  final String passwordTooShortError;
  final String showPasswordTooltip;
  final String hidePasswordTooltip;
  final String rememberDeviceLabel;
  final String signUpLabel;
  final String signInLabel;
  final String alreadyHaveAccountLabel;
  final String needAccountLabel;
  final String orContinueWithLabel;

  /// Empty hides the OAuth section.
  final List<LoginOAuthProvider> oauthProviders;

  final bool showRememberDevice;
  final bool allowSignUp;
  final int minPasswordLength;
  final double maxFormWidth;
}

/// OAuth button identity + label for [LoginViewConfig.oauthProviders].
class LoginOAuthProvider {
  const LoginOAuthProvider({
    required this.id,
    required this.label,
  });

  final String id;
  final String label;
}

import 'package:flutter/material.dart';

import '../theme/tokens/app_spacing.dart';
import 'login_view_config.dart';

/// Presentational email/password (+ optional OAuth) login form.
///
/// Callers inject copy via [config] and auth via callbacks — no l10n or
/// AuthService coupling.
class LoginView extends StatefulWidget {
  const LoginView({
    super.key,
    required this.config,
    required this.onEmailPassword,
    required this.onSuccess,
    this.onOAuth,
    this.formatError,
  });

  final LoginViewConfig config;

  final Future<void> Function({
    required String email,
    required String password,
    required bool rememberDevice,
    required bool isSignUp,
  }) onEmailPassword;

  final Future<void> Function({
    required String providerId,
    required bool rememberDevice,
  })? onOAuth;

  final VoidCallback onSuccess;

  final String Function(Object error)? formatError;

  @override
  State<LoginView> createState() => _LoginViewState();
}

class _LoginViewState extends State<LoginView> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isSignUp = false;
  bool _busy = false;
  bool _obscurePassword = true;
  bool _rememberDevice = false;
  String? _error;

  LoginViewConfig get _config => widget.config;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  String _formatError(Object error) {
    final formatter = widget.formatError;
    if (formatter != null) return formatter(error);
    return error.toString();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final email = _emailController.text.trim();
      final password = _passwordController.text;
      final remember =
          _config.showRememberDevice ? _rememberDevice : true;
      await widget.onEmailPassword(
        email: email,
        password: password,
        rememberDevice: remember,
        isSignUp: _config.allowSignUp && _isSignUp,
      );
      widget.onSuccess();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = _formatError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _oauth(String providerId) async {
    final onOAuth = widget.onOAuth;
    if (onOAuth == null) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final remember =
          _config.showRememberDevice ? _rememberDevice : true;
      await onOAuth(
        providerId: providerId,
        rememberDevice: remember,
      );
      // OAuth may redirect; success is often completed after return.
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = _formatError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final config = _config;
    const horizontalPadding = AppSpacing.lg;
    final showOAuth = config.oauthProviders.isNotEmpty;

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(horizontalPadding),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - (horizontalPadding * 2),
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: config.maxFormWidth),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            config.title,
                            style: theme.textTheme.headlineSmall,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            _isSignUp && config.allowSignUp
                                ? config.createAccountSubtitle
                                : config.signInSubtitle,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          TextFormField(
                            controller: _emailController,
                            enabled: !_busy,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email],
                            decoration: InputDecoration(
                              labelText: config.emailLabel,
                            ),
                            validator: (value) {
                              if (value == null || value.trim().isEmpty) {
                                return config.emailRequiredError;
                              }
                              if (!value.contains('@')) {
                                return config.emailInvalidError;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: AppSpacing.md),
                          TextFormField(
                            controller: _passwordController,
                            enabled: !_busy,
                            obscureText: _obscurePassword,
                            autofillHints: const [AutofillHints.password],
                            decoration: InputDecoration(
                              labelText: config.passwordLabel,
                              suffixIcon: IconButton(
                                onPressed: _busy
                                    ? null
                                    : () => setState(() {
                                          _obscurePassword = !_obscurePassword;
                                        }),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                                tooltip: _obscurePassword
                                    ? config.showPasswordTooltip
                                    : config.hidePasswordTooltip,
                              ),
                            ),
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return config.passwordRequiredError;
                              }
                              if (_isSignUp &&
                                  config.allowSignUp &&
                                  value.length < config.minPasswordLength) {
                                return config.passwordTooShortError;
                              }
                              return null;
                            },
                          ),
                          if (config.showRememberDevice) ...[
                            const SizedBox(height: AppSpacing.sm),
                            CheckboxListTile(
                              value: _rememberDevice,
                              onChanged: _busy
                                  ? null
                                  : (value) => setState(() {
                                        _rememberDevice = value ?? false;
                                      }),
                              controlAffinity: ListTileControlAffinity.leading,
                              contentPadding: EdgeInsets.zero,
                              title: Text(config.rememberDeviceLabel),
                            ),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: AppSpacing.md),
                            Text(
                              _error!,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.error,
                              ),
                            ),
                          ],
                          const SizedBox(height: AppSpacing.md),
                          FilledButton(
                            onPressed: _busy ? null : _submit,
                            child: _busy
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : Text(
                                    _isSignUp && config.allowSignUp
                                        ? config.signUpLabel
                                        : config.signInLabel,
                                  ),
                          ),
                          if (config.allowSignUp)
                            TextButton(
                              onPressed: _busy
                                  ? null
                                  : () => setState(() {
                                        _isSignUp = !_isSignUp;
                                        _error = null;
                                      }),
                              child: Text(
                                _isSignUp
                                    ? config.alreadyHaveAccountLabel
                                    : config.needAccountLabel,
                              ),
                            ),
                          if (showOAuth) ...[
                            const SizedBox(height: AppSpacing.sm),
                            const Divider(),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              config.orContinueWithLabel,
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodySmall,
                            ),
                            const SizedBox(height: AppSpacing.md),
                            Wrap(
                              spacing: AppSpacing.sm,
                              runSpacing: AppSpacing.sm,
                              alignment: WrapAlignment.center,
                              children: [
                                for (final provider in config.oauthProviders)
                                  OutlinedButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _oauth(provider.id),
                                    child: Text(provider.label),
                                  ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

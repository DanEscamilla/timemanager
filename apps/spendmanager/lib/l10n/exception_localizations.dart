import 'package:app_core/app_core.dart';

import 'app_localizations.dart';

extension AuthExceptionLocalization on AuthException {
  String localize(AppLocalizations l10n) {
    final actionLabel = switch (action) {
      AuthAction.signUp => l10n.authActionSignUp,
      AuthAction.signIn => l10n.authActionSignIn,
      AuthAction.oauth => l10n.authActionOAuth,
      null => '',
    };

    return switch (code) {
      AuthErrorCode.failedStatus =>
        l10n.authFailedStatus(actionLabel, status ?? ''),
      AuthErrorCode.noSessionToken => l10n.authNoSessionToken(actionLabel),
      AuthErrorCode.startOAuthFailed =>
        l10n.authStartOAuthFailed(provider ?? '', statusCode ?? 0),
      AuthErrorCode.authorisationUrlMissing => l10n.authAuthorisationUrlMissing,
      AuthErrorCode.couldNotGetAuthorisationUrl =>
        l10n.authCouldNotGetAuthorisationUrl,
      AuthErrorCode.couldNotOpenLogin =>
        l10n.authCouldNotOpenLogin(provider ?? ''),
      AuthErrorCode.raw => message,
    };
  }
}

extension GraphQLExceptionLocalization on GraphQLException {
  String localize(AppLocalizations l10n) => switch (code) {
        GraphQLErrorCode.notSignedIn => l10n.errorNotSignedIn,
        GraphQLErrorCode.sessionExpired => l10n.errorSessionExpired,
        GraphQLErrorCode.requestFailed => l10n.errorRequestFailed(
            statusCode ?? 0,
            responseBody ?? '',
          ),
        GraphQLErrorCode.noData => l10n.errorNoGraphQlData,
        GraphQLErrorCode.raw => message,
      };
}

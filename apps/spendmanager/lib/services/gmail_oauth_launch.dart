import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:url_launcher/url_launcher.dart';

import '../router/app_routes.dart';

/// Builds the post-consent return URL and opens Google's authorize page.
class GmailOAuthLaunch {
  /// URL mailbox-api will redirect to after Google consent.
  static String emailImportReturnTo() {
    if (kIsWeb) {
      final base = Uri.base;
      return Uri(
        scheme: base.scheme,
        host: base.host,
        port: base.hasPort ? base.port : null,
        path: AppRoutes.emailImport,
      ).toString();
    }
    return 'spendmanager://settings/email-import';
  }

  /// Same-tab on web so the OAuth redirect returns into the app.
  static Future<bool> openAuthorizationUrl(String authorizationUrl) {
    return launchUrl(
      Uri.parse(authorizationUrl),
      webOnlyWindowName: '_self',
      mode: LaunchMode.platformDefault,
    );
  }
}

import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/services/gmail_oauth_launch.dart';

void main() {
  test('emailImportReturnTo uses settings path on non-web', () {
    // Unit tests run as VM (non-web).
    expect(
      GmailOAuthLaunch.emailImportReturnTo(),
      'spendmanager://settings/email-import',
    );
  });
}

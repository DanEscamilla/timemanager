import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/models/mailbox.dart';
import 'package:spendmanager/utils/source_email_body.dart';

MailboxMessage _msg({String? textBody, String? htmlBody}) {
  return MailboxMessage(
    id: 1,
    mailboxId: 1,
    providerMessageId: 'p',
    rfcMessageId: '<x>',
    fromAddress: 'a@b.com',
    subject: 'Subj',
    receivedAt: DateTime.utc(2026, 7, 22),
    textBody: textBody,
    htmlBody: htmlBody,
    createdAt: DateTime.utc(2026, 7, 22),
  );
}

void main() {
  test('prefers text body over html', () {
    final body = displayBodyForSourceEmail(
      _msg(textBody: 'Plain total', htmlBody: '<b>HTML</b>'),
    );
    expect(body, 'Plain total');
  });

  test('falls back to stripped html when text missing', () {
    final body = displayBodyForSourceEmail(
      _msg(textBody: null, htmlBody: '<p>Hi &amp; bye<br/>line</p>'),
    );
    expect(body, 'Hi & bye\nline');
  });

  test('returns null when both bodies empty', () {
    expect(displayBodyForSourceEmail(_msg()), isNull);
    expect(displayBodyForSourceEmail(_msg(textBody: '  ', htmlBody: '')), isNull);
  });
}

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
  test('prefers html over plain text for visualization', () {
    final display = displayForSourceEmail(
      _msg(textBody: 'Plain total', htmlBody: '<b>HTML</b>'),
    );
    expect(display, isA<SourceEmailHtml>());
    expect((display as SourceEmailHtml).html, '<b>HTML</b>');
  });

  test('uses plain text when html missing', () {
    final display = displayForSourceEmail(
      _msg(textBody: 'Plain total', htmlBody: null),
    );
    expect(display, isA<SourceEmailPlain>());
    expect((display as SourceEmailPlain).text, 'Plain total');
  });

  test('returns empty when both bodies empty', () {
    expect(displayForSourceEmail(_msg()), isA<SourceEmailEmpty>());
    expect(
      displayForSourceEmail(_msg(textBody: '  ', htmlBody: '')),
      isA<SourceEmailEmpty>(),
    );
  });

  test('stripHtmlToPlainText decodes basic entities and breaks', () {
    expect(
      stripHtmlToPlainText('<p>Hi &amp; bye<br/>line</p>'),
      'Hi & bye\nline',
    );
  });
}

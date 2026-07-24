import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/models/mailbox.dart';
import 'package:spendmanager/utils/source_email_body.dart';

MailboxMessage _msg({String? textBody}) {
  return MailboxMessage(
    id: 1,
    mailboxId: 1,
    providerMessageId: 'p',
    rfcMessageId: '<x>',
    fromAddress: 'a@b.com',
    subject: 'Subj',
    receivedAt: DateTime.utc(2026, 7, 22),
    textBody: textBody,
    createdAt: DateTime.utc(2026, 7, 22),
  );
}

void main() {
  test('shows plain text body', () {
    final display = displayForSourceEmail(_msg(textBody: 'Plain total'));
    expect(display, isA<SourceEmailPlain>());
    expect((display as SourceEmailPlain).text, 'Plain total');
  });

  test('strips residual html in text_body', () {
    const html = '<!DOCTYPE html><html><body><p>Monto: \$518.81</p></body></html>';
    final display = displayForSourceEmail(_msg(textBody: html));
    expect(display, isA<SourceEmailPlain>());
    expect((display as SourceEmailPlain).text, contains('Monto: \$518.81'));
  });

  test('returns empty when text body missing', () {
    expect(displayForSourceEmail(_msg()), isA<SourceEmailEmpty>());
    expect(displayForSourceEmail(_msg(textBody: '  ')), isA<SourceEmailEmpty>());
  });

  test('stripHtmlToPlainText decodes basic entities and breaks', () {
    expect(
      stripHtmlToPlainText('<p>Hi &amp; bye<br/>line</p>'),
      'Hi & bye\nline',
    );
  });

  test('stripHtmlToPlainText drops style blocks', () {
    expect(
      stripHtmlToPlainText(
        '<style>.x{color:red}</style><p>Hello</p>',
      ),
      'Hello',
    );
  });
}

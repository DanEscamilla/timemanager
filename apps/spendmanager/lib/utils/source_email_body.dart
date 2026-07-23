import '../models/mailbox.dart';

/// How the source-email sheet should present the message body.
sealed class SourceEmailDisplay {
  const SourceEmailDisplay();
}

class SourceEmailHtml extends SourceEmailDisplay {
  const SourceEmailHtml(this.html);
  final String html;
}

class SourceEmailPlain extends SourceEmailDisplay {
  const SourceEmailPlain(this.text);
  final String text;
}

class SourceEmailEmpty extends SourceEmailDisplay {
  const SourceEmailEmpty();
}

/// Prefer HTML for visualization; fall back to plain text when HTML is absent.
SourceEmailDisplay displayForSourceEmail(MailboxMessage message) {
  final html = message.htmlBody?.trim();
  if (html != null && html.isNotEmpty) {
    return SourceEmailHtml(html);
  }

  final text = message.textBody?.trim();
  if (text != null && text.isNotEmpty) {
    return SourceEmailPlain(text);
  }

  return const SourceEmailEmpty();
}

/// Minimal tag strip kept for defensive plain-text conversion if needed.
String stripHtmlToPlainText(String html) {
  var s = html
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p\s*>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</div\s*>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]*>'), '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");
  s = s.replaceAll(RegExp(r'[ \t]+\n'), '\n');
  s = s.replaceAll(RegExp(r'\n{3,}'), '\n\n');
  return s.trim();
}

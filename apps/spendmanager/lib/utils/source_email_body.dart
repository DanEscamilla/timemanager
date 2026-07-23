import '../models/mailbox.dart';

/// Prefer plain text; fall back to a crude HTML→text strip for display.
String? displayBodyForSourceEmail(MailboxMessage message) {
  final text = message.textBody?.trim();
  if (text != null && text.isNotEmpty) return text;

  final html = message.htmlBody?.trim();
  if (html == null || html.isEmpty) return null;
  return stripHtmlToPlainText(html);
}

/// Minimal tag strip for source-email preview (not a full HTML sanitizer).
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

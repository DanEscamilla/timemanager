import '../models/mailbox.dart';

/// How the source-email sheet should present the message body.
sealed class SourceEmailDisplay {
  const SourceEmailDisplay();
}

class SourceEmailPlain extends SourceEmailDisplay {
  const SourceEmailPlain(this.text);
  final String text;
}

class SourceEmailEmpty extends SourceEmailDisplay {
  const SourceEmailEmpty();
}

final _htmlLooking = RegExp(
  r'^\s*(<!DOCTYPE\b|<html\b|<head\b|<body\b|<div\b|<table\b|<p\b|<br\b|<span\b)',
  caseSensitive: false,
);

bool looksLikeHtml(String value) => _htmlLooking.hasMatch(value);

/// Bodies are extracted to plain text at sync time; show [MailboxMessage.textBody].
/// Light HTML strip remains only for unmigrated / edge-case rows.
SourceEmailDisplay displayForSourceEmail(MailboxMessage message) {
  final text = message.textBody?.trim();
  if (text == null || text.isEmpty) return const SourceEmailEmpty();

  if (!looksLikeHtml(text)) {
    return SourceEmailPlain(text);
  }

  final stripped = stripHtmlToPlainText(text);
  if (stripped.isNotEmpty) return SourceEmailPlain(stripped);
  return const SourceEmailEmpty();
}

/// Minimal tag strip for rare rows that still contain raw HTML in text_body.
String stripHtmlToPlainText(String html) {
  var s = html
      .replaceAll(
        RegExp(r'<script[\s\S]*?</script>', caseSensitive: false),
        '',
      )
      .replaceAll(
        RegExp(r'<style[\s\S]*?</style>', caseSensitive: false),
        '',
      )
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

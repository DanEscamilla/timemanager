/// Formats a date-only [DateTime] as `YYYY-MM-DD`.
String dateToIso(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';

final _dateOnlyPrefix = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');

/// Parses a calendar date from `YYYY-MM-DD` or an ISO datetime that starts
/// with that prefix (e.g. `2026-07-13T00:00:00.000Z`).
///
/// Prefers the wire prefix over [DateTime.parse] so UTC midnight does not
/// shift to the previous local day.
DateTime parseDateOnly(String value) {
  final match = _dateOnlyPrefix.firstMatch(value.trim());
  if (match != null) {
    return DateTime(
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    );
  }
  final parsed = DateTime.parse(value);
  return DateTime(parsed.year, parsed.month, parsed.day);
}

/// Normalizes API date values to `YYYY-MM-DD`, or null when absent.
String? asDateOnlyString(dynamic value) {
  if (value == null) return null;
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  final match = _dateOnlyPrefix.firstMatch(raw);
  if (match != null) return match.group(0);
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return raw;
  return dateToIso(DateTime(parsed.year, parsed.month, parsed.day));
}

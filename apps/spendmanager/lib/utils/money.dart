/// Money helpers: store cents in the API, display major units in the UI.
String formatMoney(int amountCents, {String currency = 'USD'}) {
  final major = amountCents / 100;
  final formatted = major.toStringAsFixed(2);
  return '$currency $formatted';
}

/// Parses a user-entered amount like `12.50` or `12` into cents.
int? parseAmountToCents(String raw) {
  final trimmed = raw.trim().replaceAll(',', '');
  if (trimmed.isEmpty) return null;
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(trimmed);
  if (match == null) return null;
  final whole = int.parse(match.group(1)!);
  final frac = match.group(2);
  final cents = frac == null
      ? 0
      : int.parse(frac.padRight(2, '0'));
  return whole * 100 + cents;
}

String centsToInput(int amountCents) {
  return (amountCents / 100).toStringAsFixed(2);
}

String dateOnly(DateTime date) {
  final y = date.year.toString().padLeft(4, '0');
  final m = date.month.toString().padLeft(2, '0');
  final d = date.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

DateTime monthStart(DateTime date) => DateTime(date.year, date.month, 1);

DateTime monthEnd(DateTime date) => DateTime(date.year, date.month + 1, 0);

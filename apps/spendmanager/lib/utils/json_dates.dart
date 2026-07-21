/// Parses GraphQL timestamp fields that may arrive as ISO-8601 strings or
/// epoch millis (number or digit string).
DateTime parseJsonDate(dynamic value) {
  if (value is DateTime) return value;
  if (value is int) {
    return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
  }
  if (value is double) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true);
  }
  if (value is String) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return DateTime.now().toUtc();
    final iso = DateTime.tryParse(trimmed);
    if (iso != null) return iso.toUtc();
    final n = int.tryParse(trimmed);
    if (n != null) {
      final ms = trimmed.length <= 10 ? n * 1000 : n;
      return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
    }
  }
  return DateTime.now().toUtc();
}

DateTime? parseJsonDateOrNull(dynamic value) {
  if (value == null) return null;
  return parseJsonDate(value);
}

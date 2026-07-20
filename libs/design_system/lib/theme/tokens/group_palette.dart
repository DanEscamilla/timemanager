import 'package:flutter/material.dart';

/// Preset palette for named entities (groups, categories, rewards, …).
/// Keep in sync with API palette allowlists where applicable.
const List<String> kGroupColorPalette = [
  '#0F766E', // teal (brand)
  '#2563EB', // blue
  '#7C3AED', // violet
  '#DB2777', // pink
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // yellow
  '#16A34A', // green
  '#0891B2', // cyan
  '#4B5563', // gray
];

/// Alias for [kGroupColorPalette] with product-neutral naming.
const List<String> kEntityColorPalette = kGroupColorPalette;

/// Parses `#RRGGBB` (or `RRGGBB`) into a [Color].
/// Falls back to the first palette color if the value is invalid.
Color parseEntityColor(String hex) {
  var value = hex.trim();
  if (value.startsWith('#')) {
    value = value.substring(1);
  }
  if (value.length == 6) {
    final parsed = int.tryParse(value, radix: 16);
    if (parsed != null) {
      return Color(0xFF000000 | parsed);
    }
  }
  return parseEntityColor(kEntityColorPalette.first);
}

/// Alias for [parseEntityColor] (historical group naming).
Color parseGroupColor(String hex) => parseEntityColor(hex);

/// Whether [hex] matches a value in the shared palette (case-insensitive).
bool isAllowedEntityColor(String hex) {
  final normalized = hex.trim().toUpperCase();
  return kEntityColorPalette.any((c) => c.toUpperCase() == normalized);
}

/// Alias for [isAllowedEntityColor] (historical group naming).
bool isAllowedGroupColor(String hex) => isAllowedEntityColor(hex);

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Maps a stored preference string to a [ThemeMode].
ThemeMode themeModeFromPreference(String? value) {
  switch (value) {
    case 'light':
      return ThemeMode.light;
    case 'dark':
      return ThemeMode.dark;
    case 'system':
    case null:
    case '':
      return ThemeMode.system;
    default:
      return ThemeMode.system;
  }
}

/// Maps a [ThemeMode] to a preference string.
String preferenceFromThemeMode(ThemeMode mode) {
  return switch (mode) {
    ThemeMode.light => 'light',
    ThemeMode.dark => 'dark',
    ThemeMode.system => 'system',
  };
}

/// Persists the user's Light / Dark / System theme preference.
class ThemeModePreferenceService {
  ThemeModePreferenceService();

  static const preferenceKey = 'theme_mode';

  Future<ThemeMode> load() async {
    final prefs = await SharedPreferences.getInstance();
    return themeModeFromPreference(prefs.getString(preferenceKey));
  }

  Future<void> save(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    if (mode == ThemeMode.system) {
      await prefs.remove(preferenceKey);
    } else {
      await prefs.setString(preferenceKey, preferenceFromThemeMode(mode));
    }
  }
}

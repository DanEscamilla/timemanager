import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Maps a stored preference string to a [Locale], or `null` for system default.
Locale? localeFromPreference(String? value) {
  if (value == null || value.isEmpty) return null;
  switch (value) {
    case 'en':
      return const Locale('en');
    case 'es':
      return const Locale('es');
    default:
      return null;
  }
}

/// Maps a [Locale] override to a preference string, or `null` to clear.
String? preferenceFromLocale(Locale? locale) {
  if (locale == null) return null;
  return locale.languageCode;
}

/// Persists a debug/locale override across app launches.
class LocalePreferenceService {
  LocalePreferenceService();

  static const preferenceKey = 'debug_locale_override';

  Future<Locale?> load() async {
    final prefs = await SharedPreferences.getInstance();
    return localeFromPreference(prefs.getString(preferenceKey));
  }

  Future<void> save(Locale? locale) async {
    final prefs = await SharedPreferences.getInstance();
    final value = preferenceFromLocale(locale);
    if (value == null) {
      await prefs.remove(preferenceKey);
    } else {
      await prefs.setString(preferenceKey, value);
    }
  }
}

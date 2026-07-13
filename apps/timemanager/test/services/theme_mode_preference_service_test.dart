import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timemanager/services/theme_mode_preference_service.dart';
import 'package:timemanager/theme/app_theme.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  group('themeModeFromPreference', () {
    test('defaults to system for missing or unknown', () {
      expect(themeModeFromPreference(null), ThemeMode.system);
      expect(themeModeFromPreference(''), ThemeMode.system);
      expect(themeModeFromPreference('weird'), ThemeMode.system);
    });

    test('maps supported values', () {
      expect(themeModeFromPreference('light'), ThemeMode.light);
      expect(themeModeFromPreference('dark'), ThemeMode.dark);
      expect(themeModeFromPreference('system'), ThemeMode.system);
    });
  });

  group('preferenceFromThemeMode', () {
    test('maps modes to strings', () {
      expect(preferenceFromThemeMode(ThemeMode.light), 'light');
      expect(preferenceFromThemeMode(ThemeMode.dark), 'dark');
      expect(preferenceFromThemeMode(ThemeMode.system), 'system');
    });
  });

  group('ThemeModePreferenceService', () {
    late ThemeModePreferenceService service;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      service = ThemeModePreferenceService();
    });

    test('load returns system when unset', () async {
      expect(await service.load(), ThemeMode.system);
    });

    test('save and load round-trip', () async {
      await service.save(ThemeMode.dark);
      expect(await service.load(), ThemeMode.dark);
    });

    test('save system clears the preference key', () async {
      await service.save(ThemeMode.light);
      await service.save(ThemeMode.system);
      expect(await service.load(), ThemeMode.system);

      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.containsKey(ThemeModePreferenceService.preferenceKey),
        isFalse,
      );
    });
  });

  group('themes', () {
    test('light and dark themes build with status colors', () {
      final light = buildLightTheme();
      final dark = buildDarkTheme();
      expect(light.brightness, Brightness.light);
      expect(dark.brightness, Brightness.dark);
      expect(light.extensions.values, isNotEmpty);
      expect(dark.extensions.values, isNotEmpty);
      expect(light.colorScheme.primary, isNot(equals(Colors.transparent)));
    });
  });
}

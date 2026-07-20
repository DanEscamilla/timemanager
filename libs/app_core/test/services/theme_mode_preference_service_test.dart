import 'package:app_core/app_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('themeModeFromPreference', () {
    test('defaults to system for missing or unknown', () {
      expect(themeModeFromPreference(null), ThemeMode.system);
      expect(themeModeFromPreference(''), ThemeMode.system);
      expect(themeModeFromPreference('nope'), ThemeMode.system);
      expect(themeModeFromPreference('system'), ThemeMode.system);
    });

    test('maps light and dark', () {
      expect(themeModeFromPreference('light'), ThemeMode.light);
      expect(themeModeFromPreference('dark'), ThemeMode.dark);
    });
  });

  group('preferenceFromThemeMode', () {
    test('round-trips modes', () {
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

    test('load defaults to system when unset', () async {
      expect(await service.load(), ThemeMode.system);
    });

    test('save light and reload', () async {
      await service.save(ThemeMode.light);
      expect(await service.load(), ThemeMode.light);
    });

    test('save system clears preference key', () async {
      await service.save(ThemeMode.dark);
      await service.save(ThemeMode.system);
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.containsKey(ThemeModePreferenceService.preferenceKey),
        isFalse,
      );
    });
  });
}

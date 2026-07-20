import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:app_core/app_core.dart';

void main() {
  group('localeFromPreference', () {
    test('returns null for missing or empty values', () {
      expect(localeFromPreference(null), isNull);
      expect(localeFromPreference(''), isNull);
    });

    test('maps supported language codes', () {
      expect(localeFromPreference('en'), const Locale('en'));
      expect(localeFromPreference('es'), const Locale('es'));
    });

    test('returns null for unsupported codes', () {
      expect(localeFromPreference('fr'), isNull);
      expect(localeFromPreference('en_US'), isNull);
    });
  });

  group('preferenceFromLocale', () {
    test('returns null for system default', () {
      expect(preferenceFromLocale(null), isNull);
    });

    test('returns language code for overrides', () {
      expect(preferenceFromLocale(const Locale('en')), 'en');
      expect(preferenceFromLocale(const Locale('es')), 'es');
    });
  });

  group('LocalePreferenceService', () {
    late LocalePreferenceService service;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
      service = LocalePreferenceService();
    });

    test('load returns null when unset', () async {
      expect(await service.load(), isNull);
    });

    test('save and load round-trip a locale', () async {
      await service.save(const Locale('es'));
      expect(await service.load(), const Locale('es'));
    });

    test('save null clears the override', () async {
      await service.save(const Locale('en'));
      await service.save(null);
      expect(await service.load(), isNull);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey(LocalePreferenceService.preferenceKey), isFalse);
    });
  });
}

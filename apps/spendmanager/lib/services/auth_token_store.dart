import 'package:shared_preferences/shared_preferences.dart';

/// Key/value store for SuperTokens header-mode tokens.
abstract class AuthTokenStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

/// In-memory store (tests / non-web session fallback).
class MemoryTokenStore implements AuthTokenStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }
}

/// [SharedPreferences]-backed persistent store (localStorage on web).
class SharedPreferencesTokenStore implements AuthTokenStore {
  SharedPreferencesTokenStore(this._prefs);

  final SharedPreferences _prefs;

  @override
  Future<String?> read(String key) async => _prefs.getString(key);

  @override
  Future<void> write(String key, String value) async {
    await _prefs.setString(key, value);
  }

  @override
  Future<void> delete(String key) async {
    await _prefs.remove(key);
  }
}

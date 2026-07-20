import 'package:web/web.dart' as web;

import 'auth_token_store.dart';

/// sessionStorage-backed store — cleared when the browser tab/window closes.
class BrowserSessionTokenStore implements AuthTokenStore {
  @override
  Future<String?> read(String key) async {
    return web.window.sessionStorage.getItem(key);
  }

  @override
  Future<void> write(String key, String value) async {
    web.window.sessionStorage.setItem(key, value);
  }

  @override
  Future<void> delete(String key) async {
    web.window.sessionStorage.removeItem(key);
  }
}

AuthTokenStore createSessionTokenStore() => BrowserSessionTokenStore();

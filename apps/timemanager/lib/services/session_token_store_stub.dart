import 'auth_token_store.dart';

/// Browser sessionStorage on web; in-memory elsewhere (tests / native).
AuthTokenStore createSessionTokenStore() => MemoryTokenStore();

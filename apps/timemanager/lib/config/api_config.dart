import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// Backend connection settings for local development.
class ApiConfig {
  /// Dev user id — backend has no auth yet; clients pass this in every request.
  static const int defaultUserId = 1;

  static String get graphqlEndpoint {
    const port = 3000;
    if (kIsWeb) {
      return 'http://localhost:$port/graphql';
    }
    if (Platform.isAndroid) {
      // Android emulator maps host machine localhost to 10.0.2.2
      return 'http://10.0.2.2:$port/graphql';
    }
    return 'http://localhost:$port/graphql';
  }
}

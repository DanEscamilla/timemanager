import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import '../models/asset.dart';
import 'auth_service.dart';
import 'graphql_client.dart';

/// Client-side max upload size (matches API MAX_ASSET_BYTES = 2 MB).
const int kMaxAssetBytes = 2 * 1024 * 1024;

/// REST upload/download for reward images at `{apiBase}/assets`.
///
/// Phase 3 note: full client-side resize/compression via the `image` package is
/// awkward on Flutter web. Prefer validating size here and rejecting oversized
/// files; [prepareImageBytes] throws when over [kMaxAssetBytes].
class AssetUploadService {
  AssetUploadService({
    required AuthService authService,
    UnauthorizedHandler? onUnauthorized,
    http.Client? httpClient,
  })  : _auth = authService,
        _onUnauthorized = onUnauthorized,
        _http = httpClient ?? http.Client();

  final AuthService _auth;
  final UnauthorizedHandler? _onUnauthorized;
  final http.Client _http;

  /// Returns [bytes] unchanged when under the limit; throws [AssetUploadException]
  /// when larger than [kMaxAssetBytes].
  Uint8List prepareImageBytes(Uint8List bytes) {
    if (bytes.lengthInBytes > kMaxAssetBytes) {
      throw AssetUploadException.tooLarge(bytes.lengthInBytes);
    }
    return bytes;
  }

  Future<Asset> uploadBytes({
    required Uint8List bytes,
    required String filename,
    String contentType = 'image/jpeg',
  }) async {
    final prepared = prepareImageBytes(bytes);
    final token = await _auth.getAccessToken();
    if (token == null || token.isEmpty) {
      throw GraphQLException.notSignedIn();
    }

    final uri = Uri.parse('${ApiConfig.apiBaseUrl}/assets');
    final request = http.MultipartRequest('POST', uri)
      ..headers['Authorization'] = 'Bearer $token'
      ..files.add(
        http.MultipartFile.fromBytes(
          'file',
          prepared,
          filename: filename,
        ),
      );

    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 401) {
      await _onUnauthorized?.call();
      throw GraphQLException.sessionExpired();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AssetUploadException(
        'Upload failed (${response.statusCode}): ${response.body}',
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return Asset.fromJson(decoded);
  }

  Future<Uint8List> fetchBytes(int assetId) async {
    final token = await _auth.getAccessToken();
    if (token == null || token.isEmpty) {
      throw GraphQLException.notSignedIn();
    }

    final uri = Uri.parse('${ApiConfig.apiBaseUrl}/assets/$assetId');
    final response = await _http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );

    if (response.statusCode == 401) {
      await _onUnauthorized?.call();
      throw GraphQLException.sessionExpired();
    }
    if (response.statusCode == 404) {
      throw AssetUploadException('Asset not found', statusCode: 404);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw AssetUploadException(
        'Download failed (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }
    return response.bodyBytes;
  }
}

class AssetUploadException implements Exception {
  AssetUploadException(this.message, {this.statusCode});

  factory AssetUploadException.tooLarge(int bytes) => AssetUploadException(
        'Image is too large (${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB). '
        'Maximum is 2 MB.',
        statusCode: 413,
      );

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

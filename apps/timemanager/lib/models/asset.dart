class Asset {
  const Asset({
    required this.id,
    required this.sha256,
    required this.contentType,
    required this.byteSize,
    required this.url,
  });

  final int id;
  final String sha256;
  final String contentType;
  final int byteSize;
  final String url;

  factory Asset.fromJson(Map<String, dynamic> json) {
    return Asset(
      id: _asInt(json['id']),
      sha256: json['sha256'] as String? ?? '',
      contentType: (json['contentType'] ?? json['content_type']) as String? ??
          'application/octet-stream',
      byteSize: _asInt(json['byteSize'] ?? json['byte_size'] ?? 0),
      url: json['url'] as String? ?? '/assets/${json['id']}',
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }
}

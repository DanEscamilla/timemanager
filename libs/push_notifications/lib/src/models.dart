/// A push notification payload delivered by a [PushProvider].
class PushMessage {
  const PushMessage({
    this.title,
    this.body,
    this.data = const {},
  });

  final String? title;
  final String? body;
  final Map<String, String> data;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PushMessage &&
          title == other.title &&
          body == other.body &&
          _mapEquals(data, other.data);

  @override
  int get hashCode => Object.hash(title, body, Object.hashAll(data.entries));

  static bool _mapEquals(Map<String, String> a, Map<String, String> b) {
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (b[entry.key] != entry.value) return false;
    }
    return true;
  }
}

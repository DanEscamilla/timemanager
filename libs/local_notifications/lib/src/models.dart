/// A notification scheduled to fire at a future [fireAt].
class ScheduledNotification {
  const ScheduledNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.fireAt,
  });

  /// Stable int id for the platform plugin (31-bit positive).
  final int id;
  final String title;
  final String body;
  final DateTime fireAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'body': body,
        'fireAt': fireAt.toIso8601String(),
      };

  factory ScheduledNotification.fromJson(Map<String, dynamic> json) {
    return ScheduledNotification(
      id: json['id'] as int,
      title: json['title'] as String,
      body: json['body'] as String,
      fireAt: DateTime.parse(json['fireAt'] as String),
    );
  }
}

/// A notification to show immediately (e.g. threshold alerts).
class ImmediateNotification {
  const ImmediateNotification({
    required this.id,
    required this.title,
    required this.body,
  });

  final int id;
  final String title;
  final String body;
}

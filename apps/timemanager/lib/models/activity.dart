class Activity {
  const Activity({
    required this.id,
    required this.userId,
    required this.title,
    this.description,
    required this.startTime,
    required this.endTime,
    required this.isRecurring,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int userId;
  final String title;
  final String? description;
  final String startTime;
  final String endTime;
  final bool isRecurring;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory Activity.fromJson(Map<String, dynamic> json) {
    return Activity(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      title: json['title'] as String,
      description: json['description'] as String?,
      startTime: _formatTime(json['start_time']),
      endTime: _formatTime(json['end_time']),
      isRecurring: json['is_recurring'] as bool? ?? false,
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }

  static String _formatTime(dynamic value) {
    if (value is String) {
      // Postgres time may include seconds: "09:00:00"
      final parts = value.split(':');
      if (parts.length >= 2) {
        return '${parts[0].padLeft(2, '0')}:${parts[1].padLeft(2, '0')}';
      }
      return value;
    }
    return value.toString();
  }

  static DateTime _parseDate(dynamic value) {
    if (value is String) return DateTime.parse(value);
    return DateTime.now();
  }
}

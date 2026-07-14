import 'group.dart';
import '../utils/date_only.dart';

enum RecurrenceType {
  weekly,
  monthly,
  everyXDays;

  String get apiValue => switch (this) {
        RecurrenceType.weekly => 'weekly',
        RecurrenceType.monthly => 'monthly',
        RecurrenceType.everyXDays => 'every_x_days',
      };

  static RecurrenceType fromApi(String value) => switch (value) {
        'weekly' => RecurrenceType.weekly,
        'monthly' => RecurrenceType.monthly,
        'every_x_days' => RecurrenceType.everyXDays,
        _ => throw FormatException('Unknown recurrence type: $value'),
      };
}

class RecurrenceConfig {
  const RecurrenceConfig({
    required this.startDate,
    this.endDate,
    this.daysOfWeek,
    this.daysOfMonth,
    this.isLastDayOfMonth,
    this.intervalDays,
  });

  final String startDate;
  final String? endDate;
  final List<int>? daysOfWeek;
  final List<int>? daysOfMonth;
  final bool? isLastDayOfMonth;
  final int? intervalDays;

  factory RecurrenceConfig.fromJson(Map<String, dynamic> json) {
    return RecurrenceConfig(
      startDate: json['start_date'] as String,
      endDate: json['end_date'] as String?,
      daysOfWeek: _asIntList(json['days_of_week']),
      daysOfMonth: _asIntList(json['days_of_month']),
      isLastDayOfMonth: json['is_last_day_of_month'] as bool?,
      intervalDays: _asNullableInt(json['interval_days']),
    );
  }

  /// GraphQL input map — config fields remain snake_case on the wire.
  Map<String, dynamic> toInputMap() {
    return {
      'start_date': startDate,
      if (endDate != null) 'end_date': endDate,
      if (daysOfWeek != null) 'days_of_week': daysOfWeek,
      if (daysOfMonth != null) 'days_of_month': daysOfMonth,
      if (isLastDayOfMonth != null) 'is_last_day_of_month': isLastDayOfMonth,
      if (intervalDays != null) 'interval_days': intervalDays,
    };
  }

  static List<int>? _asIntList(dynamic value) {
    if (value == null) return null;
    return (value as List<dynamic>).map(_asInt).toList();
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }

  static int? _asNullableInt(dynamic value) {
    if (value == null) return null;
    return _asInt(value);
  }
}

class RecurrencePattern {
  const RecurrencePattern({
    this.id,
    this.activityId,
    required this.recurrenceType,
    required this.config,
    this.createdAt,
    this.updatedAt,
  });

  final int? id;
  final int? activityId;
  final RecurrenceType recurrenceType;
  final RecurrenceConfig config;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory RecurrencePattern.fromJson(Map<String, dynamic> json) {
    return RecurrencePattern(
      id: json['id'] != null ? Activity._asInt(json['id']) : null,
      activityId:
          json['activity_id'] != null ? Activity._asInt(json['activity_id']) : null,
      recurrenceType: RecurrenceType.fromApi(json['recurrence_type'] as String),
      config: RecurrenceConfig.fromJson(json['config'] as Map<String, dynamic>),
      createdAt:
          json['created_at'] != null ? Activity._parseDate(json['created_at']) : null,
      updatedAt:
          json['updated_at'] != null ? Activity._parseDate(json['updated_at']) : null,
    );
  }

  /// GraphQL mutation input — camelCase wrapper, snake_case config.
  Map<String, dynamic> toInputMap() {
    return {
      'recurrenceType': recurrenceType.apiValue,
      'config': config.toInputMap(),
    };
  }
}

class Activity {
  const Activity({
    required this.id,
    required this.userId,
    required this.title,
    this.description,
    required this.startTime,
    required this.endTime,
    required this.isRecurring,
    this.date,
    this.groupId,
    this.group,
    this.recurrencePattern,
    this.notificationOffsets = const [],
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
  final String? date;
  final int? groupId;
  final ActivityGroup? group;
  final RecurrencePattern? recurrencePattern;
  /// Minutes before [startTime]; 0 = at start. Empty = no reminders.
  final List<int> notificationOffsets;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory Activity.fromJson(Map<String, dynamic> json) {
    final patternJson = json['recurrencePattern'] as Map<String, dynamic>?;
    final groupJson = json['group'] as Map<String, dynamic>?;
    return Activity(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      title: json['title'] as String,
      description: json['description'] as String?,
      startTime: _formatTime(json['start_time']),
      endTime: _formatTime(json['end_time']),
      isRecurring: json['is_recurring'] as bool? ?? false,
      date: asDateOnlyString(json['date']),
      groupId: json['group_id'] != null ? _asInt(json['group_id']) : null,
      group: groupJson != null ? ActivityGroup.fromJson(groupJson) : null,
      recurrencePattern:
          patternJson != null ? RecurrencePattern.fromJson(patternJson) : null,
      notificationOffsets: _asIntList(json['notification_offsets']),
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }

  static List<int> _asIntList(dynamic value) {
    if (value == null) return const [];
    if (value is! List) return const [];
    return value.map(_asInt).toList();
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

/// A concrete calendar instance of an activity on a specific date.
class ActivityOccurrence {
  const ActivityOccurrence({
    required this.activity,
    required this.date,
  });

  final Activity activity;
  final DateTime date;

  String get dateString =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
}

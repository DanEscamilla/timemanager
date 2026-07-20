import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';


class ActivityGroup {
  const ActivityGroup({
    required this.id,
    required this.userId,
    required this.name,
    required this.color,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int userId;
  final String name;
  /// Hex color from the shared palette, e.g. `#0F766E`.
  final String color;
  final DateTime createdAt;
  final DateTime updatedAt;

  Color get colorValue => parseGroupColor(color);

  factory ActivityGroup.fromJson(Map<String, dynamic> json) {
    return ActivityGroup(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      name: json['name'] as String,
      color: json['color'] as String,
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }

  static DateTime _parseDate(dynamic value) {
    if (value is String) return DateTime.parse(value);
    return DateTime.now();
  }
}

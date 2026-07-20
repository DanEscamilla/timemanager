import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

class Category {
  const Category({
    required this.id,
    required this.userId,
    required this.name,
    required this.color,
    required this.createdAt,
    required this.updatedAt,
    this.archivedAt,
  });

  final int id;
  final int userId;
  final String name;
  final String color;
  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isArchived => archivedAt != null;

  Color get colorValue => parseCategoryColor(color);

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      name: json['name'] as String,
      color: json['color'] as String,
      archivedAt: json['archived_at'] != null
          ? DateTime.parse(json['archived_at'] as String)
          : null,
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

Color parseCategoryColor(String hex) {
  var value = hex.trim();
  if (value.startsWith('#')) {
    value = value.substring(1);
  }
  if (value.length == 6) {
    final parsed = int.tryParse(value, radix: 16);
    if (parsed != null) {
      return Color(0xFF000000 | parsed);
    }
  }
  return parseCategoryColor(kGroupColorPalette.first);
}

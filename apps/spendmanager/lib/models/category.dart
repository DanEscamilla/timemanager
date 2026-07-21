import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../utils/json_dates.dart';

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

  Color get colorValue => parseEntityColor(color);

  factory Category.fromJson(Map<String, dynamic> json) {
    return Category(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      name: json['name'] as String,
      color: json['color'] as String,
      archivedAt: parseJsonDateOrNull(json['archived_at']),
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }
}

/// Alias for [parseEntityColor] used by spendmanager category UI.
Color parseCategoryColor(String hex) => parseEntityColor(hex);

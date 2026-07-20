import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import 'group.dart';

enum RewardTransactionType {
  earn,
  consume,
  delete,
  restore,
  adjust,
}

extension RewardTransactionTypeApi on RewardTransactionType {
  String get apiValue => name;

  static RewardTransactionType fromApi(String? value) {
    return switch (value) {
      'consume' => RewardTransactionType.consume,
      'delete' => RewardTransactionType.delete,
      'restore' => RewardTransactionType.restore,
      'adjust' => RewardTransactionType.adjust,
      _ => RewardTransactionType.earn,
    };
  }
}

enum RewardRuleMode {
  fixed,
  probability,
  randomPool,
}

extension RewardRuleModeApi on RewardRuleMode {
  String get apiValue => switch (this) {
        RewardRuleMode.fixed => 'fixed',
        RewardRuleMode.probability => 'probability',
        RewardRuleMode.randomPool => 'random_pool',
      };

  static RewardRuleMode fromApi(String? value) {
    return switch (value) {
      'probability' => RewardRuleMode.probability,
      'random_pool' => RewardRuleMode.randomPool,
      _ => RewardRuleMode.fixed,
    };
  }
}

class RewardDefinition {
  const RewardDefinition({
    required this.id,
    required this.userId,
    required this.name,
    this.description,
    this.notes,
    this.category,
    this.tags = const [],
    required this.color,
    this.icon,
    this.imageAssetId,
    this.imageUrl,
    this.stackable = true,
    this.defaultQuantity = 1,
    this.sortOrder = 0,
    this.archivedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int userId;
  final String name;
  final String? description;
  final String? notes;
  final String? category;
  final List<String> tags;
  final String color;
  final String? icon;
  final int? imageAssetId;
  final String? imageUrl;
  final bool stackable;
  final int defaultQuantity;
  final int sortOrder;
  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isArchived => archivedAt != null;

  Color get colorValue => parseGroupColor(color);

  factory RewardDefinition.fromJson(Map<String, dynamic> json) {
    return RewardDefinition(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id'] ?? json['userId'] ?? 0),
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      notes: json['notes'] as String?,
      category: json['category'] as String?,
      tags: _asStringList(json['tags']),
      color: json['color'] as String? ?? kGroupColorPalette.first,
      icon: json['icon'] as String?,
      imageAssetId: _asIntOrNull(json['image_asset_id'] ?? json['imageAssetId']),
      imageUrl: json['image_url'] as String? ?? json['imageUrl'] as String?,
      stackable: json['stackable'] as bool? ?? true,
      defaultQuantity: _asInt(
        json['default_quantity'] ?? json['defaultQuantity'] ?? 1,
      ),
      sortOrder: _asInt(json['sort_order'] ?? json['sortOrder'] ?? 0),
      archivedAt: _parseDateOrNull(json['archived_at'] ?? json['archivedAt']),
      createdAt: _parseDate(json['created_at'] ?? json['createdAt']),
      updatedAt: _parseDate(json['updated_at'] ?? json['updatedAt']),
    );
  }
}

class RewardInventoryItem {
  const RewardInventoryItem({
    required this.id,
    required this.userId,
    required this.rewardDefinitionId,
    required this.quantity,
    this.stackKey,
    required this.firstEarnedAt,
    required this.lastEarnedAt,
    required this.updatedAt,
    this.definition,
  });

  final int id;
  final int userId;
  final int rewardDefinitionId;
  final int quantity;
  final String? stackKey;
  final DateTime firstEarnedAt;
  final DateTime lastEarnedAt;
  final DateTime updatedAt;
  final RewardDefinition? definition;

  String get name => definition?.name ?? 'Reward';
  String get color => definition?.color ?? kGroupColorPalette.first;
  Color get colorValue => parseGroupColor(color);
  String? get icon => definition?.icon;
  int? get imageAssetId => definition?.imageAssetId;

  factory RewardInventoryItem.fromJson(Map<String, dynamic> json) {
    final defRaw = json['definition'];
    return RewardInventoryItem(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id'] ?? json['userId'] ?? 0),
      rewardDefinitionId: _asInt(
        json['reward_definition_id'] ?? json['rewardDefinitionId'],
      ),
      quantity: _asInt(json['quantity'] ?? 0),
      stackKey: json['stack_key'] as String? ?? json['stackKey'] as String?,
      firstEarnedAt: _parseDate(
        json['first_earned_at'] ?? json['firstEarnedAt'],
      ),
      lastEarnedAt: _parseDate(
        json['last_earned_at'] ?? json['lastEarnedAt'],
      ),
      updatedAt: _parseDate(json['updated_at'] ?? json['updatedAt']),
      definition: defRaw is Map<String, dynamic>
          ? RewardDefinition.fromJson(defRaw)
          : null,
    );
  }
}

class RewardTransaction {
  const RewardTransaction({
    required this.id,
    required this.userId,
    required this.type,
    this.rewardDefinitionId,
    this.inventoryId,
    required this.quantity,
    required this.definitionName,
    required this.definitionColor,
    this.definitionIcon,
    this.imageAssetId,
    this.sourceType,
    this.sourceId,
    this.note,
    required this.createdAt,
  });

  final int id;
  final int userId;
  final RewardTransactionType type;
  final int? rewardDefinitionId;
  final int? inventoryId;
  final int quantity;
  final String definitionName;
  final String definitionColor;
  final String? definitionIcon;
  final int? imageAssetId;
  final String? sourceType;
  final int? sourceId;
  final String? note;
  final DateTime createdAt;

  Color get colorValue => parseGroupColor(definitionColor);

  factory RewardTransaction.fromJson(Map<String, dynamic> json) {
    return RewardTransaction(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id'] ?? json['userId'] ?? 0),
      type: RewardTransactionTypeApi.fromApi(json['type'] as String?),
      rewardDefinitionId: _asIntOrNull(
        json['reward_definition_id'] ?? json['rewardDefinitionId'],
      ),
      inventoryId: _asIntOrNull(json['inventory_id'] ?? json['inventoryId']),
      quantity: _asInt(json['quantity'] ?? 0),
      definitionName: json['definition_name'] as String? ??
          json['definitionName'] as String? ??
          '',
      definitionColor: json['definition_color'] as String? ??
          json['definitionColor'] as String? ??
          kGroupColorPalette.first,
      definitionIcon: json['definition_icon'] as String? ??
          json['definitionIcon'] as String?,
      imageAssetId: _asIntOrNull(json['image_asset_id'] ?? json['imageAssetId']),
      sourceType: json['source_type'] as String? ?? json['sourceType'] as String?,
      sourceId: _asIntOrNull(json['source_id'] ?? json['sourceId']),
      note: json['note'] as String?,
      createdAt: _parseDate(json['created_at'] ?? json['createdAt']),
    );
  }
}

class RewardRule {
  const RewardRule({
    required this.id,
    required this.userId,
    required this.sourceType,
    required this.sourceId,
    required this.rewardDefinitionId,
    required this.quantity,
    required this.mode,
    this.config = const {},
    this.enabled = true,
    required this.createdAt,
    required this.updatedAt,
    this.definition,
  });

  final int id;
  final int userId;
  final String sourceType;
  final int sourceId;
  final int rewardDefinitionId;
  final int quantity;
  final RewardRuleMode mode;
  final Map<String, dynamic> config;
  final bool enabled;
  final DateTime createdAt;
  final DateTime updatedAt;
  final RewardDefinition? definition;

  String get definitionName => definition?.name ?? 'Reward';

  factory RewardRule.fromJson(Map<String, dynamic> json) {
    final defRaw = json['definition'];
    final configRaw = json['config'];
    return RewardRule(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id'] ?? json['userId'] ?? 0),
      sourceType:
          json['source_type'] as String? ?? json['sourceType'] as String? ?? '',
      sourceId: _asInt(json['source_id'] ?? json['sourceId']),
      rewardDefinitionId: _asInt(
        json['reward_definition_id'] ?? json['rewardDefinitionId'],
      ),
      quantity: _asInt(json['quantity'] ?? 1),
      mode: RewardRuleModeApi.fromApi(json['mode'] as String?),
      config: configRaw is Map<String, dynamic>
          ? configRaw
          : const <String, dynamic>{},
      enabled: json['enabled'] as bool? ?? true,
      createdAt: _parseDate(json['created_at'] ?? json['createdAt']),
      updatedAt: _parseDate(json['updated_at'] ?? json['updatedAt']),
      definition: defRaw is Map<String, dynamic>
          ? RewardDefinition.fromJson(defRaw)
          : null,
    );
  }
}

class RewardInventoryMutationResult {
  const RewardInventoryMutationResult({
    this.inventory,
    required this.transaction,
  });

  final RewardInventoryItem? inventory;
  final RewardTransaction transaction;

  factory RewardInventoryMutationResult.fromJson(Map<String, dynamic> json) {
    final inv = json['inventory'];
    return RewardInventoryMutationResult(
      inventory: inv is Map<String, dynamic>
          ? RewardInventoryItem.fromJson(inv)
          : null,
      transaction: RewardTransaction.fromJson(
        json['transaction'] as Map<String, dynamic>,
      ),
    );
  }
}

class RewardNudge {
  const RewardNudge({
    required this.kind,
    required this.title,
    required this.message,
    required this.severity,
    this.definitionId,
    this.inventoryId,
  });

  final String kind;
  final String title;
  final String message;
  final String severity;
  final int? definitionId;
  final int? inventoryId;

  factory RewardNudge.fromJson(Map<String, dynamic> json) {
    return RewardNudge(
      kind: json['kind'] as String? ?? '',
      title: json['title'] as String? ?? '',
      message: json['message'] as String? ?? '',
      severity: json['severity'] as String? ?? 'info',
      definitionId: _asIntOrNull(json['definitionId'] ?? json['definition_id']),
      inventoryId: _asIntOrNull(json['inventoryId'] ?? json['inventory_id']),
    );
  }
}

int _asInt(dynamic value) {
  if (value is int) return value;
  if (value is double) return value.toInt();
  return int.parse(value.toString());
}

int? _asIntOrNull(dynamic value) {
  if (value == null) return null;
  return _asInt(value);
}

DateTime _parseDate(dynamic value) {
  if (value is String) return DateTime.parse(value);
  return DateTime.now();
}

DateTime? _parseDateOrNull(dynamic value) {
  if (value == null) return null;
  if (value is String && value.isNotEmpty) return DateTime.parse(value);
  return null;
}

List<String> _asStringList(dynamic value) {
  if (value == null) return const [];
  if (value is List) return value.map((e) => e.toString()).toList();
  if (value is String) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return const [];
    if (trimmed.startsWith('[')) {
      try {
        final parsed = jsonDecode(trimmed);
        if (parsed is List) {
          return parsed.map((e) => e.toString()).toList();
        }
      } catch (_) {}
    }
    return [value];
  }
  return const [];
}

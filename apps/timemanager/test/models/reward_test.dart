import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/reward.dart';

void main() {
  test('RewardDefinition.fromJson parses snake_case fields', () {
    final def = RewardDefinition.fromJson({
      'id': 1,
      'user_id': 2,
      'name': 'Movie night',
      'description': 'Watch something fun',
      'notes': null,
      'category': 'leisure',
      'tags': ['fun', 'evening'],
      'color': '#0F766E',
      'icon': '🎬',
      'image_asset_id': 9,
      'image_url': '/assets/9',
      'stackable': true,
      'default_quantity': 2,
      'sort_order': 3,
      'archived_at': null,
      'created_at': '2026-07-13T00:00:00.000Z',
      'updated_at': '2026-07-13T00:00:00.000Z',
    });

    expect(def.id, 1);
    expect(def.userId, 2);
    expect(def.name, 'Movie night');
    expect(def.tags, ['fun', 'evening']);
    expect(def.imageAssetId, 9);
    expect(def.imageUrl, '/assets/9');
    expect(def.defaultQuantity, 2);
    expect(def.isArchived, false);
  });

  test('RewardInventoryItem.fromJson nests definition', () {
    final item = RewardInventoryItem.fromJson({
      'id': 10,
      'user_id': 2,
      'reward_definition_id': 1,
      'quantity': 3,
      'stack_key': null,
      'first_earned_at': '2026-07-10T00:00:00.000Z',
      'last_earned_at': '2026-07-13T00:00:00.000Z',
      'updated_at': '2026-07-13T00:00:00.000Z',
      'definition': {
        'id': 1,
        'user_id': 2,
        'name': 'Coffee',
        'color': '#B45309',
        'stackable': true,
        'default_quantity': 1,
        'sort_order': 0,
        'created_at': '2026-07-01T00:00:00.000Z',
        'updated_at': '2026-07-01T00:00:00.000Z',
      },
    });

    expect(item.quantity, 3);
    expect(item.rewardDefinitionId, 1);
    expect(item.name, 'Coffee');
    expect(item.definition?.color, '#B45309');
  });

  test('RewardTransaction.fromJson maps type enum', () {
    final tx = RewardTransaction.fromJson({
      'id': 5,
      'user_id': 2,
      'type': 'consume',
      'reward_definition_id': 1,
      'inventory_id': 10,
      'quantity': 1,
      'definition_name': 'Coffee',
      'definition_color': '#B45309',
      'definition_icon': null,
      'image_asset_id': null,
      'source_type': 'manual',
      'source_id': 0,
      'note': 'morning treat',
      'created_at': '2026-07-13T12:00:00.000Z',
    });

    expect(tx.type, RewardTransactionType.consume);
    expect(tx.definitionName, 'Coffee');
    expect(tx.note, 'morning treat');
    expect(tx.quantity, 1);
  });
}

import '../models/asset.dart';
import '../models/reward.dart';
import 'graphql_client.dart';

class RewardRepository {
  RewardRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _definitionFields = '''
    id
    user_id
    name
    description
    notes
    category
    tags
    color
    icon
    image_asset_id
    image_url
    stackable
    default_quantity
    sort_order
    archived_at
    created_at
    updated_at
  ''';

  static const _inventoryFields = '''
    id
    user_id
    reward_definition_id
    quantity
    stack_key
    first_earned_at
    last_earned_at
    updated_at
    definition {
      $_definitionFields
    }
  ''';

  static const _transactionFields = '''
    id
    user_id
    type
    reward_definition_id
    inventory_id
    quantity
    definition_name
    definition_color
    definition_icon
    image_asset_id
    source_type
    source_id
    note
    created_at
  ''';

  static const _ruleFields = '''
    id
    user_id
    source_type
    source_id
    reward_definition_id
    quantity
    mode
    config
    enabled
    created_at
    updated_at
    definition {
      $_definitionFields
    }
  ''';

  static const _assetFields = '''
    id
    sha256
    content_type
    byte_size
    url
  ''';

  Future<List<RewardDefinition>> fetchDefinitions({
    bool includeArchived = false,
    String? search,
    String? category,
    int? limit,
    int? offset,
  }) async {
    final data = await _client.query('''
      query FetchRewardDefinitions(\$filter: RewardDefinitionsFilterInput) {
        rewardDefinitions(args: { filter: \$filter }) {
          $_definitionFields
        }
      }
    ''', variables: {
      'filter': {
        'includeArchived': includeArchived,
        if (search != null) 'search': search,
        if (category != null) 'category': category,
        if (limit != null) 'limit': limit,
        if (offset != null) 'offset': offset,
      },
    });

    final list = data['rewardDefinitions'] as List<dynamic>? ?? [];
    return list
        .map((e) => RewardDefinition.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<RewardDefinition?> fetchDefinition(int id) async {
    final data = await _client.query('''
      query FetchRewardDefinition(\$id: Number!) {
        rewardDefinition(args: { id: \$id }) {
          $_definitionFields
        }
      }
    ''', variables: {'id': id});

    final raw = data['rewardDefinition'];
    if (raw == null) return null;
    return RewardDefinition.fromJson(raw as Map<String, dynamic>);
  }

  Future<RewardDefinition> createDefinition({
    required String name,
    String? description,
    String? notes,
    String? category,
    List<String>? tags,
    required String color,
    String? icon,
    int? imageAssetId,
    bool stackable = true,
    int defaultQuantity = 1,
    int sortOrder = 0,
  }) async {
    final data = await _client.mutate('''
      mutation CreateRewardDefinition(\$input: CreateRewardDefinitionInputInput!) {
        createRewardDefinition(args: { input: \$input }) {
          $_definitionFields
        }
      }
    ''', variables: {
      'input': {
        'name': name,
        'description': description,
        'notes': notes,
        'category': category,
        'tags': tags ?? const <String>[],
        'color': color,
        'icon': icon,
        'imageAssetId': imageAssetId,
        'stackable': stackable,
        'defaultQuantity': defaultQuantity,
        'sortOrder': sortOrder,
      },
    });

    return RewardDefinition.fromJson(
      data['createRewardDefinition'] as Map<String, dynamic>,
    );
  }

  Future<RewardDefinition> updateDefinition({
    required int id,
    String? name,
    String? description,
    String? notes,
    String? category,
    List<String>? tags,
    String? color,
    String? icon,
    int? imageAssetId,
    bool clearImage = false,
    bool? stackable,
    int? defaultQuantity,
    int? sortOrder,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateRewardDefinition(
        \$id: Number!
        \$input: UpdateRewardDefinitionInputInput!
      ) {
        updateRewardDefinition(args: { id: \$id, input: \$input }) {
          $_definitionFields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (notes != null) 'notes': notes,
        if (category != null) 'category': category,
        if (tags != null) 'tags': tags,
        if (color != null) 'color': color,
        if (icon != null) 'icon': icon,
        if (clearImage) 'imageAssetId': null,
        if (!clearImage && imageAssetId != null) 'imageAssetId': imageAssetId,
        if (stackable != null) 'stackable': stackable,
        if (defaultQuantity != null) 'defaultQuantity': defaultQuantity,
        if (sortOrder != null) 'sortOrder': sortOrder,
      },
    });

    return RewardDefinition.fromJson(
      data['updateRewardDefinition'] as Map<String, dynamic>,
    );
  }

  Future<RewardDefinition> archiveDefinition(int id) async {
    final data = await _client.mutate('''
      mutation ArchiveRewardDefinition(\$id: Number!) {
        archiveRewardDefinition(args: { id: \$id }) {
          $_definitionFields
        }
      }
    ''', variables: {'id': id});

    return RewardDefinition.fromJson(
      data['archiveRewardDefinition'] as Map<String, dynamic>,
    );
  }

  Future<RewardDefinition> unarchiveDefinition(int id) async {
    final data = await _client.mutate('''
      mutation UnarchiveRewardDefinition(\$id: Number!) {
        unarchiveRewardDefinition(args: { id: \$id }) {
          $_definitionFields
        }
      }
    ''', variables: {'id': id});

    return RewardDefinition.fromJson(
      data['unarchiveRewardDefinition'] as Map<String, dynamic>,
    );
  }

  Future<bool> deleteDefinition(int id) async {
    final data = await _client.mutate('''
      mutation DeleteRewardDefinition(\$id: Number!) {
        deleteRewardDefinition(args: { id: \$id })
      }
    ''', variables: {'id': id});

    return data['deleteRewardDefinition'] as bool? ?? false;
  }

  Future<List<RewardInventoryItem>> fetchInventory({
    String? search,
    bool? stackableOnly,
    String? sort,
    int? limit,
    int? offset,
  }) async {
    final data = await _client.query('''
      query FetchRewardInventory(\$filter: RewardInventoryFilterInput) {
        rewardInventory(args: { filter: \$filter }) {
          $_inventoryFields
        }
      }
    ''', variables: {
      'filter': {
        if (search != null) 'search': search,
        if (stackableOnly != null) 'stackableOnly': stackableOnly,
        if (sort != null) 'sort': sort,
        if (limit != null) 'limit': limit,
        if (offset != null) 'offset': offset,
      },
    });

    final list = data['rewardInventory'] as List<dynamic>? ?? [];
    return list
        .map((e) => RewardInventoryItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<RewardTransaction>> fetchHistory({
    int? definitionId,
    String? type,
    int? limit,
    int? offset,
  }) async {
    final data = await _client.query('''
      query FetchRewardHistory(\$filter: RewardHistoryFilterInput) {
        rewardHistory(args: { filter: \$filter }) {
          $_transactionFields
        }
      }
    ''', variables: {
      'filter': {
        if (definitionId != null) 'definitionId': definitionId,
        if (type != null) 'type': type,
        if (limit != null) 'limit': limit,
        if (offset != null) 'offset': offset,
      },
    });

    final list = data['rewardHistory'] as List<dynamic>? ?? [];
    return list
        .map((e) => RewardTransaction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<RewardRule>> fetchRules({
    required String sourceType,
    required int sourceId,
  }) async {
    final data = await _client.query('''
      query FetchRewardRules(\$sourceType: String!, \$sourceId: Number!) {
        rewardRules(args: { sourceType: \$sourceType, sourceId: \$sourceId }) {
          $_ruleFields
        }
      }
    ''', variables: {
      'sourceType': sourceType,
      'sourceId': sourceId,
    });

    final list = data['rewardRules'] as List<dynamic>? ?? [];
    return list
        .map((e) => RewardRule.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<RewardRule> attachRule({
    required String sourceType,
    required int sourceId,
    required int rewardDefinitionId,
    int quantity = 1,
    RewardRuleMode mode = RewardRuleMode.fixed,
    String? configJson,
    bool enabled = true,
  }) async {
    final data = await _client.mutate('''
      mutation AttachRewardRule(\$input: AttachRewardRuleInputInput!) {
        attachRewardRule(args: { input: \$input }) {
          $_ruleFields
        }
      }
    ''', variables: {
      'input': {
        'sourceType': sourceType,
        'sourceId': sourceId,
        'rewardDefinitionId': rewardDefinitionId,
        'quantity': quantity,
        'mode': mode.apiValue,
        if (configJson != null) 'configJson': configJson,
        'enabled': enabled,
      },
    });

    return RewardRule.fromJson(
      data['attachRewardRule'] as Map<String, dynamic>,
    );
  }

  Future<bool> detachRule(int id) async {
    final data = await _client.mutate('''
      mutation DetachRewardRule(\$id: Number!) {
        detachRewardRule(args: { id: \$id })
      }
    ''', variables: {'id': id});

    return data['detachRewardRule'] as bool? ?? false;
  }

  Future<RewardInventoryMutationResult> consumeReward({
    required int inventoryId,
    int quantity = 1,
    String? note,
  }) async {
    final data = await _client.mutate('''
      mutation ConsumeReward(\$input: ConsumeRewardInputInput!) {
        consumeReward(args: { input: \$input }) {
          inventory { $_inventoryFields }
          transaction { $_transactionFields }
        }
      }
    ''', variables: {
      'input': {
        'inventoryId': inventoryId,
        'quantity': quantity,
        if (note != null) 'note': note,
      },
    });

    return RewardInventoryMutationResult.fromJson(
      data['consumeReward'] as Map<String, dynamic>,
    );
  }

  Future<RewardInventoryMutationResult> discardReward({
    required int inventoryId,
    int quantity = 1,
  }) async {
    final data = await _client.mutate('''
      mutation DiscardReward(\$input: DiscardRewardInputInput!) {
        discardReward(args: { input: \$input }) {
          inventory { $_inventoryFields }
          transaction { $_transactionFields }
        }
      }
    ''', variables: {
      'input': {
        'inventoryId': inventoryId,
        'quantity': quantity,
      },
    });

    return RewardInventoryMutationResult.fromJson(
      data['discardReward'] as Map<String, dynamic>,
    );
  }

  Future<RewardInventoryMutationResult> restoreReward(int transactionId) async {
    final data = await _client.mutate('''
      mutation RestoreReward(\$transactionId: Number!) {
        restoreReward(args: { transactionId: \$transactionId }) {
          inventory { $_inventoryFields }
          transaction { $_transactionFields }
        }
      }
    ''', variables: {'transactionId': transactionId});

    return RewardInventoryMutationResult.fromJson(
      data['restoreReward'] as Map<String, dynamic>,
    );
  }

  Future<RewardTransaction?> manualGrant({
    required int rewardDefinitionId,
    int quantity = 1,
    String? note,
  }) async {
    final data = await _client.mutate('''
      mutation ManualGrantReward(\$input: ManualGrantRewardInputInput!) {
        manualGrantReward(args: { input: \$input }) {
          $_transactionFields
        }
      }
    ''', variables: {
      'input': {
        'rewardDefinitionId': rewardDefinitionId,
        'quantity': quantity,
        if (note != null) 'note': note,
      },
    });

    final raw = data['manualGrantReward'];
    if (raw == null) return null;
    return RewardTransaction.fromJson(raw as Map<String, dynamic>);
  }

  Future<List<Asset>> fetchRecentAssets({int limit = 20}) async {
    final data = await _client.query('''
      query FetchRecentAssets(\$limit: Number) {
        recentAssets(args: { limit: \$limit }) {
          $_assetFields
        }
      }
    ''', variables: {'limit': limit});

    final list = data['recentAssets'] as List<dynamic>? ?? [];
    return list
        .map((e) => Asset.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<RewardNudge>> fetchNudges() async {
    final data = await _client.query('''
      query FetchRewardNudges {
        rewardNudges(args: {}) {
          kind
          title
          message
          severity
          definitionId
          inventoryId
        }
      }
    ''');

    final list = data['rewardNudges'] as List<dynamic>? ?? [];
    return list
        .map((e) => RewardNudge.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

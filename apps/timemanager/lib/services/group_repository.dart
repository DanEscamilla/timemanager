import '../models/group.dart';
import 'graphql_client.dart';

class GroupRepository {
  GroupRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _groupFields = '''
    id
    user_id
    name
    color
    created_at
    updated_at
  ''';

  Future<List<ActivityGroup>> fetchGroups() async {
    final data = await _client.query('''
      query FetchGroups {
        groups(args: {}) {
          $_groupFields
        }
      }
    ''');

    final list = data['groups'] as List<dynamic>? ?? [];
    return list
        .map((item) => ActivityGroup.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<ActivityGroup> createGroup({
    required String name,
    required String color,
  }) async {
    final data = await _client.mutate('''
      mutation CreateGroup(\$input: CreateGroupInputInput!) {
        createGroup(args: { input: \$input }) {
          $_groupFields
        }
      }
    ''', variables: {
      'input': {
        'name': name,
        'color': color,
      },
    });

    return ActivityGroup.fromJson(
      data['createGroup'] as Map<String, dynamic>,
    );
  }

  Future<ActivityGroup> updateGroup({
    required int id,
    required String name,
    required String color,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateGroup(\$id: Number!, \$input: UpdateGroupInputInput!) {
        updateGroup(args: { id: \$id, input: \$input }) {
          $_groupFields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        'name': name,
        'color': color,
      },
    });

    return ActivityGroup.fromJson(
      data['updateGroup'] as Map<String, dynamic>,
    );
  }

  Future<void> deleteGroup(int id) async {
    await _client.mutate('''
      mutation DeleteGroup(\$id: Number!) {
        deleteGroup(args: { id: \$id })
      }
    ''', variables: {'id': id});
  }
}

import '../models/category.dart';
import 'graphql_client.dart';

class CategoryRepository {
  CategoryRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _fields = '''
    id
    user_id
    name
    color
    archived_at
    created_at
    updated_at
  ''';

  Future<List<Category>> fetchCategories({bool includeArchived = false}) async {
    final data = await _client.query('''
      query FetchCategories(\$includeArchived: Boolean) {
        categories(args: { includeArchived: \$includeArchived }) {
          $_fields
        }
      }
    ''', variables: {
      'includeArchived': includeArchived,
    });

    final list = data['categories'] as List<dynamic>? ?? [];
    return list
        .map((item) => Category.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Category> createCategory({
    required String name,
    required String color,
  }) async {
    final data = await _client.mutate('''
      mutation CreateCategory(\$input: CreateCategoryInputInput!) {
        createCategory(args: { input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'input': {
        'name': name,
        'color': color,
      },
    });

    return Category.fromJson(data['createCategory'] as Map<String, dynamic>);
  }

  Future<Category> updateCategory({
    required int id,
    required String name,
    required String color,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateCategory(\$id: Number!, \$input: UpdateCategoryInputInput!) {
        updateCategory(args: { id: \$id, input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        'name': name,
        'color': color,
      },
    });

    return Category.fromJson(data['updateCategory'] as Map<String, dynamic>);
  }

  Future<Category> archiveCategory(int id) async {
    final data = await _client.mutate('''
      mutation ArchiveCategory(\$id: Number!) {
        archiveCategory(args: { id: \$id }) {
          $_fields
        }
      }
    ''', variables: {
      'id': id,
    });

    return Category.fromJson(data['archiveCategory'] as Map<String, dynamic>);
  }
}

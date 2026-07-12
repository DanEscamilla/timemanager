import '../models/activity.dart';
import 'graphql_client.dart';

class ActivityRepository {
  ActivityRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _activityFields = '''
    id
    user_id
    title
    description
    start_time
    end_time
    is_recurring
    created_at
    updated_at
  ''';

  Future<List<Activity>> fetchActivities() async {
    final data = await _client.query('''
      query FetchActivities {
        activities(args: {}) {
          $_activityFields
        }
      }
    ''');

    final list = data['activities'] as List<dynamic>? ?? [];
    return list
        .map((item) => Activity.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Activity> createActivity({
    required String title,
    String? description,
    required String startTime,
    required String endTime,
  }) async {
    // Pylon returns createActivity as Object! — no subfield selection allowed.
    final data = await _client.mutate('''
      mutation CreateActivity(\$input: CreateActivityInputInput!) {
        createActivity(args: { input: \$input })
      }
    ''', variables: {
      'input': {
        'title': title,
        'description': description,
        'startTime': startTime,
        'endTime': endTime,
        'isRecurring': false,
      },
    });

    return Activity.fromJson(
      data['createActivity'] as Map<String, dynamic>,
    );
  }

  Future<Activity> updateActivity({
    required int id,
    required String title,
    String? description,
    required String startTime,
    required String endTime,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateActivity(\$id: Number!, \$input: UpdateActivityInputInput!) {
        updateActivity(args: { id: \$id, input: \$input })
      }
    ''', variables: {
      'id': id,
      'input': {
        'title': title,
        'description': description,
        'startTime': startTime,
        'endTime': endTime,
        'isRecurring': false,
      },
    });

    return Activity.fromJson(
      data['updateActivity'] as Map<String, dynamic>,
    );
  }

  Future<void> deleteActivity(int id) async {
    await _client.mutate('''
      mutation DeleteActivity(\$id: Number!) {
        deleteActivity(args: { id: \$id })
      }
    ''', variables: {'id': id});
  }
}

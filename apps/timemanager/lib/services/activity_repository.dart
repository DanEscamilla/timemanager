import '../config/api_config.dart';
import '../models/activity.dart';
import 'graphql_client.dart';

class ActivityRepository {
  ActivityRepository({GraphQLClient? client, int? userId})
    : _client = client ?? GraphQLClient(),
      _userId = userId ?? ApiConfig.defaultUserId;

  final GraphQLClient _client;
  final int _userId;

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
      query FetchActivities(\$userId: Number!) {
        activities(args: {}, context: { userId: \$userId }) {
          $_activityFields
        }
      }
    ''', variables: {'userId': _userId});

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
      mutation CreateActivity(\$userId: Number!, \$input: CreateActivityInputInput!) {
        createActivity(args: { input: \$input }, context: { userId: \$userId })
      }
    ''', variables: {
      'userId': _userId,
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
      mutation UpdateActivity(\$userId: Number!, \$id: Number!, \$input: UpdateActivityInputInput!) {
        updateActivity(args: { id: \$id, input: \$input }, context: { userId: \$userId })
      }
    ''', variables: {
      'userId': _userId,
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
      mutation DeleteActivity(\$userId: Number!, \$id: Number!) {
        deleteActivity(args: { id: \$id }, context: { userId: \$userId })
      }
    ''', variables: {'userId': _userId, 'id': id});
  }
}

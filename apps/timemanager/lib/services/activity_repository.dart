import '../models/activity.dart';
import 'activity_notification_scheduler.dart';
import 'graphql_client.dart';

class ActivityRepository {
  ActivityRepository({
    GraphQLClient? client,
    ActivityNotificationScheduler? notificationScheduler,
  })  : _client = client ?? GraphQLClient(),
        _notifications =
            notificationScheduler ?? ActivityNotificationScheduler.instance;

  final GraphQLClient _client;
  final ActivityNotificationScheduler _notifications;

  static const _activityFields = '''
    id
    user_id
    title
    description
    start_time
    end_time
    is_recurring
    date
    group_id
    notification_offsets
    created_at
    updated_at
    group {
      id
      user_id
      name
      color
      created_at
      updated_at
    }
    recurrencePattern {
      id
      activity_id
      recurrence_type
      config {
        days_of_week
        days_of_month
        is_last_day_of_month
        interval_days
        start_date
        end_date
      }
      created_at
      updated_at
    }
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

  /// Fetches activities and refreshes the local notification schedule.
  Future<List<Activity>> fetchAndSyncNotifications() async {
    final activities = await fetchActivities();
    await _notifications.sync(activities);
    return activities;
  }

  Future<void> _resyncNotifications() async {
    try {
      final activities = await fetchActivities();
      await _notifications.sync(activities);
    } catch (_) {
      // Scheduling is best-effort; don't fail the mutation.
    }
  }

  Future<Activity> createActivity({
    required String title,
    String? description,
    required String startTime,
    required String endTime,
    required bool isRecurring,
    String? date,
    RecurrencePattern? recurrencePattern,
    int? groupId,
    List<int> notificationOffsets = const [],
  }) async {
    final data = await _client.mutate('''
      mutation CreateActivity(\$input: CreateActivityInputInput!) {
        createActivity(args: { input: \$input }) {
          $_activityFields
        }
      }
    ''', variables: {
      'input': {
        'title': title,
        'description': description,
        'startTime': startTime,
        'endTime': endTime,
        'isRecurring': isRecurring,
        if (date != null) 'date': date,
        if (recurrencePattern != null)
          'recurrencePattern': recurrencePattern.toInputMap(),
        'groupId': groupId,
        'notificationOffsets': notificationOffsets,
      },
    });

    final activity = Activity.fromJson(
      data['createActivity'] as Map<String, dynamic>,
    );
    if (notificationOffsets.isNotEmpty) {
      await _notifications.requestPermission();
    }
    await _resyncNotifications();
    return activity;
  }

  Future<Activity> updateActivity({
    required int id,
    required String title,
    String? description,
    required String startTime,
    required String endTime,
    required bool isRecurring,
    String? date,
    RecurrencePattern? recurrencePattern,
    int? groupId,
    List<int> notificationOffsets = const [],
  }) async {
    final data = await _client.mutate('''
      mutation UpdateActivity(\$id: Number!, \$input: UpdateActivityInputInput!) {
        updateActivity(args: { id: \$id, input: \$input }) {
          $_activityFields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        'title': title,
        'description': description,
        'startTime': startTime,
        'endTime': endTime,
        'isRecurring': isRecurring,
        if (date != null) 'date': date,
        if (recurrencePattern != null)
          'recurrencePattern': recurrencePattern.toInputMap(),
        'groupId': groupId,
        'notificationOffsets': notificationOffsets,
      },
    });

    final activity = Activity.fromJson(
      data['updateActivity'] as Map<String, dynamic>,
    );
    if (notificationOffsets.isNotEmpty) {
      await _notifications.requestPermission();
    }
    await _resyncNotifications();
    return activity;
  }

  Future<void> deleteActivity(int id) async {
    await _client.mutate('''
      mutation DeleteActivity(\$id: Number!) {
        deleteActivity(args: { id: \$id })
      }
    ''', variables: {'id': id});
    await _resyncNotifications();
  }
}

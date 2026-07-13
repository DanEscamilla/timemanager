import '../models/goal.dart';
import 'graphql_client.dart';

class GoalRepository {
  GoalRepository({GraphQLClient? client}) : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _goalFields = '''
    id
    user_id
    title
    description
    color
    icon
    rule_type
    metric
    target_value
    config {
      composite_mode
      count_required
      before_time
      after_time
      block_until_unlocked
    }
    status
    recurrence {
      period
      interval
      anchor
      carry_over
    }
    deadline {
      kind
      date
      days_after_cycle_start
      grace_days
      warn_days
    }
    priority
    sort_order
    created_at
    updated_at
    isLocked
    activeCycle {
      id
      goal_id
      cycle_index
      starts_at
      ends_at
      deadline_at
      target_value
      current_value
      status
      carry_over
      deadlineState
      percentComplete
      remaining
    }
    links {
      id
      goal_id
      link_type
      activity_id
      group_id
      weight
      activity { id title }
      group { id name color }
    }
    dependencies {
      id
      goal_id
      depends_on_goal_id
      requirement
      threshold
      weight
      dependsOn { id title }
    }
    snapshots {
      id
      goal_cycle_id
      as_of
      value
    }
  ''';

  Future<List<Goal>> fetchGoals({String? status}) async {
    final data = await _client.query('''
      query FetchGoals(\$status: String) {
        goals(args: { status: \$status }) {
          $_goalFields
        }
      }
    ''', variables: {
      if (status != null) 'status': status,
    });

    final list = data['goals'] as List<dynamic>? ?? [];
    return list
        .map((item) => Goal.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Goal?> fetchGoal(int id) async {
    final data = await _client.query('''
      query FetchGoal(\$id: Number!) {
        goal(args: { id: \$id }) {
          $_goalFields
        }
      }
    ''', variables: {'id': id});

    final raw = data['goal'];
    if (raw == null) return null;
    return Goal.fromJson(raw as Map<String, dynamic>);
  }

  Future<List<GoalNudge>> fetchNudges() async {
    final data = await _client.query('''
      query FetchGoalNudges {
        goalNudges(args: {}) {
          kind
          goalId
          title
          message
          severity
        }
      }
    ''');
    final list = data['goalNudges'] as List<dynamic>? ?? [];
    return list
        .map((e) => GoalNudge.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<DailyProgress> fetchDailyProgress({String? date}) async {
    final data = await _client.query('''
      query FetchDailyProgress(\$date: String) {
        dailyProgress(args: { date: \$date }) {
          date
          completedCount
          minutesToday
          streakDays
        }
      }
    ''', variables: {
      if (date != null) 'date': date,
    });
    return DailyProgress.fromJson(
      data['dailyProgress'] as Map<String, dynamic>,
    );
  }

  Future<Goal> createGoal({
    required String title,
    String? description,
    required String color,
    String? icon,
    required String ruleType,
    required String metric,
    required double targetValue,
    Map<String, dynamic>? config,
    required List<Map<String, dynamic>> links,
    List<Map<String, dynamic>>? dependencies,
    Map<String, dynamic>? recurrence,
    Map<String, dynamic>? deadline,
    int priority = 0,
  }) async {
    final data = await _client.mutate('''
      mutation CreateGoal(\$input: CreateGoalInputInput!) {
        createGoal(args: { input: \$input }) {
          $_goalFields
        }
      }
    ''', variables: {
      'input': {
        'title': title,
        'description': description,
        'color': color,
        'icon': icon,
        'ruleType': ruleType,
        'metric': metric,
        'targetValue': targetValue,
        if (config != null) 'config': config,
        'links': links,
        if (dependencies != null) 'dependencies': dependencies,
        if (recurrence != null) 'recurrence': recurrence,
        if (deadline != null) 'deadline': deadline,
        'priority': priority,
      },
    });

    return Goal.fromJson(data['createGoal'] as Map<String, dynamic>);
  }

  Future<Goal> updateGoal({
    required int id,
    String? title,
    String? description,
    String? color,
    String? icon,
    String? ruleType,
    String? metric,
    double? targetValue,
    Map<String, dynamic>? config,
    List<Map<String, dynamic>>? links,
    List<Map<String, dynamic>>? dependencies,
    Map<String, dynamic>? recurrence,
    Map<String, dynamic>? deadline,
    String? status,
    int? priority,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateGoal(\$id: Number!, \$input: UpdateGoalInputInput!) {
        updateGoal(args: { id: \$id, input: \$input }) {
          $_goalFields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        if (title != null) 'title': title,
        if (description != null) 'description': description,
        if (color != null) 'color': color,
        if (icon != null) 'icon': icon,
        if (ruleType != null) 'ruleType': ruleType,
        if (metric != null) 'metric': metric,
        if (targetValue != null) 'targetValue': targetValue,
        if (config != null) 'config': config,
        if (links != null) 'links': links,
        if (dependencies != null) 'dependencies': dependencies,
        if (recurrence != null) 'recurrence': recurrence,
        if (deadline != null) 'deadline': deadline,
        if (status != null) 'status': status,
        if (priority != null) 'priority': priority,
      },
    });

    return Goal.fromJson(data['updateGoal'] as Map<String, dynamic>);
  }

  Future<Goal> pauseGoal(int id) async {
    final data = await _client.mutate('''
      mutation PauseGoal(\$id: Number!) {
        pauseGoal(args: { id: \$id }) { $_goalFields }
      }
    ''', variables: {'id': id});
    return Goal.fromJson(data['pauseGoal'] as Map<String, dynamic>);
  }

  Future<Goal> resumeGoal(int id) async {
    final data = await _client.mutate('''
      mutation ResumeGoal(\$id: Number!) {
        resumeGoal(args: { id: \$id }) { $_goalFields }
      }
    ''', variables: {'id': id});
    return Goal.fromJson(data['resumeGoal'] as Map<String, dynamic>);
  }

  Future<Goal> archiveGoal(int id) async {
    final data = await _client.mutate('''
      mutation ArchiveGoal(\$id: Number!) {
        archiveGoal(args: { id: \$id }) { $_goalFields }
      }
    ''', variables: {'id': id});
    return Goal.fromJson(data['archiveGoal'] as Map<String, dynamic>);
  }

  Future<void> deleteGoal(int id) async {
    await _client.mutate('''
      mutation DeleteGoal(\$id: Number!) {
        deleteGoal(args: { id: \$id })
      }
    ''', variables: {'id': id});
  }
}

class CompletionRepository {
  CompletionRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  Future<ActivityCompletion> completeActivity({
    required int activityId,
    required String occurrenceDate,
    int? durationMinutes,
    String? notes,
  }) async {
    final data = await _client.mutate('''
      mutation CompleteActivity(\$input: CompleteActivityInputInput!) {
        completeActivity(args: { input: \$input }) {
          id
          activity_id
          user_id
          occurrence_date
          duration_minutes
          completed_at
        }
      }
    ''', variables: {
      'input': {
        'activityId': activityId,
        'occurrenceDate': occurrenceDate,
        if (durationMinutes != null) 'durationMinutes': durationMinutes,
        if (notes != null) 'notes': notes,
      },
    });

    return ActivityCompletion.fromJson(
      data['completeActivity'] as Map<String, dynamic>,
    );
  }

  Future<void> undoCompletion(int id) async {
    await _client.mutate('''
      mutation UndoCompletion(\$id: Number!) {
        undoCompletion(args: { id: \$id })
      }
    ''', variables: {'id': id});
  }

  Future<void> logTime({
    required int activityId,
    required int durationMinutes,
    String? occurrenceDate,
    String? notes,
  }) async {
    await _client.mutate('''
      mutation LogTime(\$input: LogTimeInputInput!) {
        logTime(args: { input: \$input }) {
          id
          amount
        }
      }
    ''', variables: {
      'input': {
        'activityId': activityId,
        'durationMinutes': durationMinutes,
        if (occurrenceDate != null) 'occurrenceDate': occurrenceDate,
        if (notes != null) 'notes': notes,
      },
    });
  }

  Future<List<ActivityCompletion>> fetchCompletions({
    int? activityId,
    String? fromDate,
    String? toDate,
  }) async {
    final data = await _client.query('''
      query FetchCompletions(
        \$activityId: Number
        \$fromDate: String
        \$toDate: String
      ) {
        activityCompletions(args: {
          activityId: \$activityId
          fromDate: \$fromDate
          toDate: \$toDate
        }) {
          id
          activity_id
          user_id
          occurrence_date
          duration_minutes
          completed_at
        }
      }
    ''', variables: {
      if (activityId != null) 'activityId': activityId,
      if (fromDate != null) 'fromDate': fromDate,
      if (toDate != null) 'toDate': toDate,
    });

    final list = data['activityCompletions'] as List<dynamic>? ?? [];
    return list
        .map((e) => ActivityCompletion.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

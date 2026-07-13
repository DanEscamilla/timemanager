import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/goal.dart';

void main() {
  test('Goal.fromJson parses active cycle progress', () {
    final goal = Goal.fromJson({
      'id': 1,
      'user_id': 2,
      'title': 'Read 10h',
      'description': null,
      'color': '#0F766E',
      'icon': null,
      'rule_type': 'activity_duration',
      'metric': 'duration',
      'target_value': 600,
      'config': {},
      'status': 'active',
      'recurrence': {'period': 'weekly', 'interval': 1, 'carry_over': 'none'},
      'deadline': {
        'kind': 'relative',
        'days_after_cycle_start': 7,
        'warn_days': 3,
      },
      'priority': 1,
      'sort_order': 0,
      'starts_at': '2026-07-13T00:00:00.000Z',
      'lifecyclePhase': 'active',
      'created_at': '2026-07-13T00:00:00.000Z',
      'updated_at': '2026-07-13T00:00:00.000Z',
      'isLocked': false,
      'activeCycle': {
        'id': 10,
        'goal_id': 1,
        'cycle_index': 0,
        'starts_at': '2026-07-13T00:00:00.000Z',
        'ends_at': '2026-07-20T00:00:00.000Z',
        'deadline_at': '2026-07-20T00:00:00.000Z',
        'target_value': 600,
        'current_value': 120,
        'status': 'active',
        'carry_over': 0,
        'deadlineState': 'on_track',
        'percentComplete': 0.2,
        'remaining': 480,
      },
      'links': [
        {
          'id': 1,
          'goal_id': 1,
          'link_type': 'activity',
          'activity_id': 5,
          'group_id': null,
          'weight': 1,
          'activity': {'id': 5, 'title': 'Read'},
        },
      ],
      'dependencies': [],
      'snapshots': [],
    });

    expect(goal.ruleType, GoalRuleType.activityDuration);
    expect(goal.metric, GoalMetric.duration);
    expect(goal.startsAt.toUtc().toIso8601String(), '2026-07-13T00:00:00.000Z');
    expect(goal.lifecyclePhase, GoalLifecyclePhase.active);
    expect(goal.isScheduled, false);
    expect(goal.recurrence?.period, 'weekly');
    expect(goal.deadline?.kind, 'relative');
    expect(goal.activeCycle?.currentValue, 120);
    expect(goal.progressRatio, closeTo(0.2, 0.001));
    expect(goal.links.single.activityTitle, 'Read');
  });

  test('Goal.fromJson derives scheduled lifecyclePhase', () {
    final future = DateTime.now().toUtc().add(const Duration(days: 10));
    final goal = Goal.fromJson({
      'id': 2,
      'user_id': 2,
      'title': 'Future',
      'color': '#0F766E',
      'rule_type': 'activity_count',
      'metric': 'count',
      'target_value': 5,
      'config': {},
      'status': 'active',
      'starts_at': future.toIso8601String(),
      'lifecyclePhase': 'scheduled',
      'created_at': '2026-07-13T00:00:00.000Z',
      'updated_at': '2026-07-13T00:00:00.000Z',
      'links': [],
      'dependencies': [],
      'snapshots': [],
    });
    expect(goal.isScheduled, true);
    expect(goal.daysUntilStart(), greaterThan(0));
  });

  test('GoalRuleTypeApi round-trips api values', () {
    for (final type in GoalRuleType.values) {
      expect(GoalRuleTypeApi.fromApi(type.apiValue), type);
    }
  });
}

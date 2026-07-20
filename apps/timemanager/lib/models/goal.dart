import 'package:design_system/design_system.dart';
import 'dart:ui';

import '../utils/date_only.dart';

enum GoalMetric { count, duration }

enum GoalStatus { active, paused, completed, archived, failed }

enum GoalLifecyclePhase {
  scheduled,
  active,
  paused,
  completed,
  archived,
  failed,
}

enum GoalCycleStatus { active, succeeded, failed, missed }

enum GoalLinkType { activity, group }

enum GoalRuleType {
  activityCount,
  activityDuration,
  groupDuration,
  groupCount,
  groupAnyCount,
  groupAllComplete,
  multiActivityDuration,
  streak,
  timeOfDayCount,
  composite,
}

extension GoalRuleTypeApi on GoalRuleType {
  String get apiValue => switch (this) {
        GoalRuleType.activityCount => 'activity_count',
        GoalRuleType.activityDuration => 'activity_duration',
        GoalRuleType.groupDuration => 'group_duration',
        GoalRuleType.groupCount => 'group_count',
        GoalRuleType.groupAnyCount => 'group_any_count',
        GoalRuleType.groupAllComplete => 'group_all_complete',
        GoalRuleType.multiActivityDuration => 'multi_activity_duration',
        GoalRuleType.streak => 'streak',
        GoalRuleType.timeOfDayCount => 'time_of_day_count',
        GoalRuleType.composite => 'composite',
      };

  static GoalRuleType fromApi(String value) {
    return GoalRuleType.values.firstWhere(
      (e) => e.apiValue == value,
      orElse: () => GoalRuleType.activityCount,
    );
  }
}

class GoalRecurrence {
  const GoalRecurrence({
    required this.period,
    this.interval = 1,
    this.anchor,
    this.carryOver = 'none',
  });

  final String period; // weekly | monthly | quarterly | every_x_days
  final int interval;
  final String? anchor;
  final String carryOver;

  factory GoalRecurrence.fromJson(Map<String, dynamic> json) {
    return GoalRecurrence(
      period: json['period'] as String? ?? 'weekly',
      interval: (json['interval'] as num?)?.toInt() ?? 1,
      anchor: json['anchor'] as String?,
      carryOver: json['carry_over'] as String? ??
          json['carryOver'] as String? ??
          'none',
    );
  }

  Map<String, dynamic> toInputMap() => {
        'period': period,
        'interval': interval,
        if (anchor != null) 'anchor': anchor,
        'carryOver': carryOver,
      };
}

class GoalDeadline {
  const GoalDeadline({
    required this.kind,
    this.date,
    this.daysAfterCycleStart,
    this.graceDays,
    this.warnDays,
  });

  final String kind; // absolute | relative
  final String? date;
  final int? daysAfterCycleStart;
  final int? graceDays;
  final int? warnDays;

  factory GoalDeadline.fromJson(Map<String, dynamic> json) {
    return GoalDeadline(
      kind: json['kind'] as String? ?? 'absolute',
      date: json['date'] as String?,
      daysAfterCycleStart:
          (json['days_after_cycle_start'] as num?)?.toInt() ??
              (json['daysAfterCycleStart'] as num?)?.toInt(),
      graceDays: (json['grace_days'] as num?)?.toInt() ??
          (json['graceDays'] as num?)?.toInt(),
      warnDays: (json['warn_days'] as num?)?.toInt() ??
          (json['warnDays'] as num?)?.toInt(),
    );
  }

  Map<String, dynamic> toInputMap() => {
        'kind': kind,
        if (date != null) 'date': date,
        if (daysAfterCycleStart != null)
          'daysAfterCycleStart': daysAfterCycleStart,
        if (graceDays != null) 'graceDays': graceDays,
        if (warnDays != null) 'warnDays': warnDays,
      };
}

class GoalConfig {
  const GoalConfig({
    this.compositeMode,
    this.countRequired,
    this.beforeTime,
    this.afterTime,
    this.blockUntilUnlocked,
  });

  final String? compositeMode;
  final int? countRequired;
  final String? beforeTime;
  final String? afterTime;
  final bool? blockUntilUnlocked;

  factory GoalConfig.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const GoalConfig();
    return GoalConfig(
      compositeMode: json['composite_mode'] as String? ??
          json['compositeMode'] as String?,
      countRequired: (json['count_required'] as num?)?.toInt() ??
          (json['countRequired'] as num?)?.toInt(),
      beforeTime:
          json['before_time'] as String? ?? json['beforeTime'] as String?,
      afterTime: json['after_time'] as String? ?? json['afterTime'] as String?,
      blockUntilUnlocked: json['block_until_unlocked'] as bool? ??
          json['blockUntilUnlocked'] as bool?,
    );
  }

  Map<String, dynamic> toInputMap() => {
        if (compositeMode != null) 'compositeMode': compositeMode,
        if (countRequired != null) 'countRequired': countRequired,
        if (beforeTime != null) 'beforeTime': beforeTime,
        if (afterTime != null) 'afterTime': afterTime,
        if (blockUntilUnlocked != null)
          'blockUntilUnlocked': blockUntilUnlocked,
      };
}

class GoalLink {
  const GoalLink({
    required this.id,
    required this.goalId,
    required this.linkType,
    this.activityId,
    this.groupId,
    this.weight = 1,
    this.activityTitle,
    this.groupName,
  });

  final int id;
  final int goalId;
  final GoalLinkType linkType;
  final int? activityId;
  final int? groupId;
  final double weight;
  final String? activityTitle;
  final String? groupName;

  bool get isDangling =>
      (linkType == GoalLinkType.activity && activityId == null) ||
      (linkType == GoalLinkType.group && groupId == null);

  factory GoalLink.fromJson(Map<String, dynamic> json) {
    final linkTypeRaw = json['link_type'] as String? ?? 'activity';
    final activity = json['activity'] as Map<String, dynamic>?;
    final group = json['group'] as Map<String, dynamic>?;
    return GoalLink(
      id: json['id'] as int,
      goalId: json['goal_id'] as int? ?? 0,
      linkType: linkTypeRaw == 'group'
          ? GoalLinkType.group
          : GoalLinkType.activity,
      activityId: json['activity_id'] as int?,
      groupId: json['group_id'] as int?,
      weight: (json['weight'] as num?)?.toDouble() ?? 1,
      activityTitle: activity?['title'] as String?,
      groupName: group?['name'] as String?,
    );
  }
}

class GoalDependency {
  const GoalDependency({
    required this.id,
    required this.goalId,
    required this.dependsOnGoalId,
    required this.requirement,
    this.threshold,
    this.weight = 1,
    this.dependsOnTitle,
  });

  final int id;
  final int goalId;
  final int dependsOnGoalId;
  final String requirement;
  final double? threshold;
  final double weight;
  final String? dependsOnTitle;

  factory GoalDependency.fromJson(Map<String, dynamic> json) {
    final dependsOn = json['dependsOn'] as Map<String, dynamic>?;
    return GoalDependency(
      id: json['id'] as int,
      goalId: json['goal_id'] as int? ?? 0,
      dependsOnGoalId: json['depends_on_goal_id'] as int,
      requirement: json['requirement'] as String? ?? 'complete',
      threshold: (json['threshold'] as num?)?.toDouble(),
      weight: (json['weight'] as num?)?.toDouble() ?? 1,
      dependsOnTitle: dependsOn?['title'] as String?,
    );
  }
}

class GoalCycle {
  const GoalCycle({
    required this.id,
    required this.goalId,
    required this.cycleIndex,
    required this.startsAt,
    this.endsAt,
    this.deadlineAt,
    required this.targetValue,
    required this.currentValue,
    required this.status,
    this.carryOver = 0,
    this.deadlineState,
    this.percentComplete,
    this.remaining,
  });

  final int id;
  final int goalId;
  final int cycleIndex;
  final DateTime startsAt;
  final DateTime? endsAt;
  final DateTime? deadlineAt;
  final double targetValue;
  final double currentValue;
  final GoalCycleStatus status;
  final double carryOver;
  final String? deadlineState;
  final double? percentComplete;
  final double? remaining;

  double get progressRatio {
    if (percentComplete != null) return percentComplete!.clamp(0, 1);
    if (targetValue <= 0) return 0;
    return (currentValue / targetValue).clamp(0, 1);
  }

  factory GoalCycle.fromJson(Map<String, dynamic> json) {
    GoalCycleStatus parseStatus(String? raw) {
      return GoalCycleStatus.values.firstWhere(
        (e) => e.name == raw,
        orElse: () => GoalCycleStatus.active,
      );
    }

    return GoalCycle(
      id: json['id'] as int,
      goalId: json['goal_id'] as int? ?? 0,
      cycleIndex: json['cycle_index'] as int? ?? 0,
      startsAt: DateTime.parse(json['starts_at'] as String),
      endsAt: json['ends_at'] != null
          ? DateTime.tryParse(json['ends_at'] as String)
          : null,
      deadlineAt: json['deadline_at'] != null
          ? DateTime.tryParse(json['deadline_at'] as String)
          : null,
      targetValue: (json['target_value'] as num?)?.toDouble() ?? 0,
      currentValue: (json['current_value'] as num?)?.toDouble() ?? 0,
      status: parseStatus(json['status'] as String?),
      carryOver: (json['carry_over'] as num?)?.toDouble() ?? 0,
      deadlineState: json['deadlineState'] as String?,
      percentComplete: (json['percentComplete'] as num?)?.toDouble(),
      remaining: (json['remaining'] as num?)?.toDouble(),
    );
  }
}

class GoalProgressSnapshot {
  const GoalProgressSnapshot({
    required this.id,
    required this.goalCycleId,
    required this.asOf,
    required this.value,
  });

  final int id;
  final int goalCycleId;
  final String asOf;
  final double value;

  factory GoalProgressSnapshot.fromJson(Map<String, dynamic> json) {
    return GoalProgressSnapshot(
      id: json['id'] as int,
      goalCycleId: json['goal_cycle_id'] as int? ?? 0,
      asOf: json['as_of'] as String,
      value: (json['value'] as num?)?.toDouble() ?? 0,
    );
  }
}

class Goal {
  const Goal({
    required this.id,
    required this.userId,
    required this.title,
    this.description,
    required this.color,
    this.icon,
    required this.ruleType,
    required this.metric,
    required this.targetValue,
    required this.config,
    required this.status,
    required this.startsAt,
    this.lifecyclePhase = GoalLifecyclePhase.active,
    this.recurrence,
    this.deadline,
    this.priority = 0,
    this.sortOrder = 0,
    required this.createdAt,
    required this.updatedAt,
    this.activeCycle,
    this.links = const [],
    this.dependencies = const [],
    this.snapshots = const [],
    this.isLocked = false,
  });

  final int id;
  final int userId;
  final String title;
  final String? description;
  final String color;
  final String? icon;
  final GoalRuleType ruleType;
  final GoalMetric metric;
  final double targetValue;
  final GoalConfig config;
  final GoalStatus status;
  final DateTime startsAt;
  final GoalLifecyclePhase lifecyclePhase;
  final GoalRecurrence? recurrence;
  final GoalDeadline? deadline;
  final int priority;
  final int sortOrder;
  final DateTime createdAt;
  final DateTime updatedAt;
  final GoalCycle? activeCycle;
  final List<GoalLink> links;
  final List<GoalDependency> dependencies;
  final List<GoalProgressSnapshot> snapshots;
  final bool isLocked;

  bool get isScheduled => lifecyclePhase == GoalLifecyclePhase.scheduled;

  Color get colorValue {
    final hex = color.replaceFirst('#', '');
    if (hex.length != 6) {
      return Color(
        int.parse(kGroupColorPalette.first.replaceFirst('#', ''), radix: 16) +
            0xFF000000,
      );
    }
    return Color(int.parse(hex, radix: 16) + 0xFF000000);
  }

  double get progressRatio => activeCycle?.progressRatio ?? 0;

  /// Days until start (0 if already started or starting today).
  int daysUntilStart({DateTime? now}) {
    final n = now ?? DateTime.now();
    if (!startsAt.isAfter(n)) return 0;
    return startsAt.difference(n).inDays +
        (startsAt.difference(n).inHours % 24 > 0 ? 1 : 0);
  }

  factory Goal.fromJson(Map<String, dynamic> json) {
    GoalStatus parseStatus(String? raw) {
      return GoalStatus.values.firstWhere(
        (e) => e.name == raw,
        orElse: () => GoalStatus.active,
      );
    }

    GoalLifecyclePhase parsePhase(String? raw, GoalStatus status, DateTime startsAt) {
      if (raw != null) {
        return GoalLifecyclePhase.values.firstWhere(
          (e) => e.name == raw,
          orElse: () => GoalLifecyclePhase.active,
        );
      }
      if (status == GoalStatus.paused) return GoalLifecyclePhase.paused;
      if (status == GoalStatus.completed) return GoalLifecyclePhase.completed;
      if (status == GoalStatus.archived) return GoalLifecyclePhase.archived;
      if (status == GoalStatus.failed) return GoalLifecyclePhase.failed;
      if (status == GoalStatus.active && startsAt.isAfter(DateTime.now())) {
        return GoalLifecyclePhase.scheduled;
      }
      return GoalLifecyclePhase.active;
    }

    GoalMetric parseMetric(String? raw) {
      return raw == 'duration' ? GoalMetric.duration : GoalMetric.count;
    }

    final linksRaw = json['links'] as List<dynamic>? ?? [];
    final depsRaw = json['dependencies'] as List<dynamic>? ?? [];
    final snapsRaw = json['snapshots'] as List<dynamic>? ?? [];
    final status = parseStatus(json['status'] as String?);
    final startsAt = DateTime.tryParse(
          json['startsAt'] as String? ??
              json['starts_at'] as String? ??
              '',
        ) ??
        DateTime.tryParse(json['created_at'] as String? ?? '') ??
        DateTime.now();

    return Goal(
      id: json['id'] as int,
      userId: json['user_id'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      color: json['color'] as String? ?? kGroupColorPalette.first,
      icon: json['icon'] as String?,
      ruleType: GoalRuleTypeApi.fromApi(json['rule_type'] as String? ?? ''),
      metric: parseMetric(json['metric'] as String?),
      targetValue: (json['target_value'] as num?)?.toDouble() ?? 0,
      config: GoalConfig.fromJson(
        json['config'] is Map
            ? Map<String, dynamic>.from(json['config'] as Map)
            : null,
      ),
      status: status,
      startsAt: startsAt,
      lifecyclePhase: parsePhase(
        json['lifecyclePhase'] as String?,
        status,
        startsAt,
      ),
      recurrence: json['recurrence'] is Map<String, dynamic>
          ? GoalRecurrence.fromJson(json['recurrence'] as Map<String, dynamic>)
          : null,
      deadline: json['deadline'] is Map<String, dynamic>
          ? GoalDeadline.fromJson(json['deadline'] as Map<String, dynamic>)
          : null,
      priority: json['priority'] as int? ?? 0,
      sortOrder: json['sort_order'] as int? ?? 0,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ??
          DateTime.now(),
      updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? '') ??
          DateTime.now(),
      activeCycle: json['activeCycle'] is Map<String, dynamic>
          ? GoalCycle.fromJson(json['activeCycle'] as Map<String, dynamic>)
          : null,
      links: linksRaw
          .map((e) => GoalLink.fromJson(e as Map<String, dynamic>))
          .toList(),
      dependencies: depsRaw
          .map((e) => GoalDependency.fromJson(e as Map<String, dynamic>))
          .toList(),
      snapshots: snapsRaw
          .map((e) => GoalProgressSnapshot.fromJson(e as Map<String, dynamic>))
          .toList(),
      isLocked: json['isLocked'] as bool? ?? false,
    );
  }
}

class GoalNudge {
  const GoalNudge({
    required this.kind,
    required this.goalId,
    required this.title,
    required this.message,
    required this.severity,
  });

  final String kind;
  final int goalId;
  final String title;
  final String message;
  final String severity;

  factory GoalNudge.fromJson(Map<String, dynamic> json) {
    return GoalNudge(
      kind: json['kind'] as String? ?? '',
      goalId: json['goalId'] as int? ?? 0,
      title: json['title'] as String? ?? '',
      message: json['message'] as String? ?? '',
      severity: json['severity'] as String? ?? 'info',
    );
  }
}

class DailyProgress {
  const DailyProgress({
    required this.date,
    required this.completedCount,
    required this.minutesToday,
    required this.streakDays,
  });

  final String date;
  final int completedCount;
  final double minutesToday;
  final int streakDays;

  factory DailyProgress.fromJson(Map<String, dynamic> json) {
    return DailyProgress(
      date: json['date'] as String? ?? '',
      completedCount: json['completedCount'] as int? ?? 0,
      minutesToday: (json['minutesToday'] as num?)?.toDouble() ?? 0,
      streakDays: json['streakDays'] as int? ?? 0,
    );
  }
}

class ActivityCompletion {
  const ActivityCompletion({
    required this.id,
    required this.activityId,
    required this.userId,
    required this.occurrenceDate,
    this.durationMinutes,
    required this.completedAt,
  });

  final int id;
  final int activityId;
  final int userId;
  final String occurrenceDate;
  final int? durationMinutes;
  final DateTime completedAt;

  factory ActivityCompletion.fromJson(Map<String, dynamic> json) {
    return ActivityCompletion(
      id: json['id'] as int,
      activityId: json['activity_id'] as int,
      userId: json['user_id'] as int? ?? 0,
      occurrenceDate: asDateOnlyString(json['occurrence_date']) ?? '',
      durationMinutes: json['duration_minutes'] as int?,
      completedAt: DateTime.parse(json['completed_at'] as String),
    );
  }
}

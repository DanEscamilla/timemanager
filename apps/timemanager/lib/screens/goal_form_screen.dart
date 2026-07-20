import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../models/goal.dart';
import '../models/group.dart';
import '../services/activity_repository.dart';
import '../services/goal_repository.dart';
import '../services/group_repository.dart';
import '../services/reward_repository.dart';
import '../theme/tokens/app_spacing.dart';
import '../theme/tokens/group_palette.dart';
import '../utils/form_advanced_values.dart';
import '../widgets/advanced_form_section.dart';
import '../widgets/loading_view.dart';
import '../widgets/reward_rules_section.dart';

/// Create / edit goal form covering MVP + advanced rule types.
class GoalFormScreen extends StatefulWidget {
  const GoalFormScreen({
    super.key,
    required this.goalRepository,
    required this.activityRepository,
    required this.groupRepository,
    this.rewardRepository,
    this.goal,
  });

  final GoalRepository goalRepository;
  final ActivityRepository activityRepository;
  final GroupRepository groupRepository;
  final RewardRepository? rewardRepository;
  final Goal? goal;

  @override
  State<GoalFormScreen> createState() => _GoalFormScreenState();
}

class _GoalFormScreenState extends State<GoalFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _advancedKey = GlobalKey<AdvancedFormSectionState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _targetController;

  GoalRuleType _ruleType = GoalRuleType.activityCount;
  GoalMetric _metric = GoalMetric.count;
  String _color = kGroupColorPalette.first;
  final Set<int> _activityIds = {};
  final Set<int> _groupIds = {};
  final Set<int> _dependencyIds = {};
  String? _recurrencePeriod;
  int _recurrenceInterval = 1;
  String? _deadlineKind;
  DateTime? _absoluteDeadline;
  int _relativeDeadlineDays = 7;
  /// null = start immediately (omit startsAt on create).
  DateTime? _startDate;
  bool _useCustomStart = false;
  bool _blockUntilUnlocked = false;
  String _compositeMode = 'all';
  int _countRequired = 1;
  bool _saving = false;
  String? _error;

  List<Activity> _activities = const [];
  List<ActivityGroup> _groups = const [];
  List<Goal> _otherGoals = const [];
  bool _loading = true;

  bool get _hasAdvancedValues => goalHasAdvancedValues(
        description: _descriptionController.text,
        color: _color,
        isComposite: _isComposite,
        dependencyIds: _dependencyIds,
        blockUntilUnlocked: _blockUntilUnlocked,
        useCustomStart: _useCustomStart,
        recurrencePeriod: _recurrencePeriod,
        deadlineKind: _deadlineKind,
      );

  @override
  void initState() {
    super.initState();
    final g = widget.goal;
    _titleController = TextEditingController(text: g?.title ?? '');
    _descriptionController = TextEditingController(text: g?.description ?? '');
    _targetController = TextEditingController(
      text: g != null ? g.targetValue.toStringAsFixed(0) : '10',
    );
    if (g != null) {
      _ruleType = g.ruleType;
      _metric = g.metric;
      _color = g.color;
      _blockUntilUnlocked = g.config.blockUntilUnlocked ?? false;
      _compositeMode = g.config.compositeMode ?? 'all';
      _countRequired = g.config.countRequired ?? 1;
      for (final link in g.links) {
        if (link.linkType == GoalLinkType.activity && link.activityId != null) {
          _activityIds.add(link.activityId!);
        }
        if (link.linkType == GoalLinkType.group && link.groupId != null) {
          _groupIds.add(link.groupId!);
        }
      }
      for (final dep in g.dependencies) {
        _dependencyIds.add(dep.dependsOnGoalId);
      }
      _recurrencePeriod = g.recurrence?.period;
      _recurrenceInterval = g.recurrence?.interval ?? 1;
      _deadlineKind = g.deadline?.kind;
      if (g.deadline?.date != null) {
        _absoluteDeadline = DateTime.tryParse(g.deadline!.date!);
      }
      _relativeDeadlineDays = g.deadline?.daysAfterCycleStart ?? 7;
      final localStart = g.startsAt.toLocal();
      _startDate = DateTime(localStart.year, localStart.month, localStart.day);
      _useCustomStart = true;
    }
    _loadOptions();
  }

  Future<void> _loadOptions() async {
    try {
      final activities = await widget.activityRepository.fetchActivities();
      final groups = await widget.groupRepository.fetchGroups();
      final goals = await widget.goalRepository.fetchGoals();
      if (!mounted) return;
      setState(() {
        _activities = activities;
        _groups = groups;
        _otherGoals = goals
            .where((g) => widget.goal == null || g.id != widget.goal!.id)
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _targetController.dispose();
    super.dispose();
  }

  bool get _needsActivities =>
      _ruleType == GoalRuleType.activityCount ||
      _ruleType == GoalRuleType.activityDuration ||
      _ruleType == GoalRuleType.multiActivityDuration ||
      _ruleType == GoalRuleType.streak ||
      _ruleType == GoalRuleType.timeOfDayCount;

  bool get _needsGroups =>
      _ruleType == GoalRuleType.groupDuration ||
      _ruleType == GoalRuleType.groupCount ||
      _ruleType == GoalRuleType.groupAnyCount ||
      _ruleType == GoalRuleType.groupAllComplete;

  bool get _isComposite => _ruleType == GoalRuleType.composite;

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    if (!_formKey.currentState!.validate()) {
      _advancedKey.currentState?.expand();
      return;
    }

    if (!_isComposite) {
      if (_needsActivities && _activityIds.isEmpty) {
        setState(() => _error = l10n.goalsFormSelectActivity);
        return;
      }
      if (_needsGroups && _groupIds.isEmpty) {
        setState(() => _error = l10n.goalsFormSelectGroup);
        return;
      }
    } else if (_dependencyIds.isEmpty) {
      setState(() => _error = l10n.goalsFormSelectDependency);
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    final target = double.tryParse(_targetController.text.trim()) ?? 0;
    final links = <Map<String, dynamic>>[
      for (final id in _activityIds)
        {'linkType': 'activity', 'activityId': id, 'weight': 1},
      for (final id in _groupIds)
        {'linkType': 'group', 'groupId': id, 'weight': 1},
    ];
    final deps = [
      for (final id in _dependencyIds)
        {
          'dependsOnGoalId': id,
          'requirement': 'complete',
          'weight': 1,
        },
    ];

    Map<String, dynamic>? recurrence;
    if (_recurrencePeriod != null) {
      recurrence = {
        'period': _recurrencePeriod,
        'interval': _recurrenceInterval,
        'carryOver': 'none',
      };
    }

    Map<String, dynamic>? deadline;
    if (_deadlineKind == 'absolute' && _absoluteDeadline != null) {
      final d = _absoluteDeadline!;
      deadline = {
        'kind': 'absolute',
        'date':
            '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
        'warnDays': 3,
        'graceDays': 1,
      };
    } else if (_deadlineKind == 'relative') {
      deadline = {
        'kind': 'relative',
        'daysAfterCycleStart': _relativeDeadlineDays,
        'warnDays': 3,
        'graceDays': 1,
      };
    }

    final config = <String, dynamic>{
      if (_isComposite) 'compositeMode': _compositeMode,
      if (_isComposite && _compositeMode == 'any')
        'countRequired': _countRequired,
      if (_blockUntilUnlocked) 'blockUntilUnlocked': true,
    };

    // Auto-pick metric from rule type when obvious.
    final metric = switch (_ruleType) {
      GoalRuleType.activityDuration ||
      GoalRuleType.groupDuration ||
      GoalRuleType.multiActivityDuration =>
        'duration',
      _ => _metric == GoalMetric.duration ? 'duration' : 'count',
    };

    /// Local calendar date → start of that day as UTC ISO (server stores UTC).
    String? startsAtIso;
    if (_useCustomStart && _startDate != null) {
      final local = DateTime(_startDate!.year, _startDate!.month, _startDate!.day);
      startsAtIso = local.toUtc().toIso8601String();
    }

    try {
      if (widget.goal == null) {
        await widget.goalRepository.createGoal(
          title: _titleController.text.trim(),
          description: _descriptionController.text.trim().isEmpty
              ? null
              : _descriptionController.text.trim(),
          color: _color,
          ruleType: _ruleType.apiValue,
          metric: metric,
          targetValue: target,
          config: config.isEmpty ? null : config,
          links: _isComposite ? const [] : links,
          dependencies: deps.isEmpty ? null : deps,
          recurrence: recurrence,
          deadline: deadline,
          startsAt: startsAtIso,
        );
      } else {
        var confirmLaterStart = false;
        final existing = widget.goal!;
        if (startsAtIso != null) {
          final newStart = DateTime.parse(startsAtIso);
          final progressBegun =
              (existing.activeCycle?.currentValue ?? 0) > 0;
          if (progressBegun && newStart.isAfter(existing.startsAt)) {
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: Text(l10n.goalsStartsAtConfirmTitle),
                content: Text(l10n.goalsStartsAtConfirmBody),
                    actions: [
                  TextButton(
                    onPressed: () => Navigator.of(ctx).pop(false),
                    child: Text(l10n.activitiesCancel),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(ctx).pop(true),
                    child: Text(l10n.goalsStartsAtConfirmAction),
                  ),
                ],
              ),
            );
            if (confirmed != true) {
              if (!mounted) return;
              setState(() => _saving = false);
              return;
            }
            confirmLaterStart = true;
          }
        }

        await widget.goalRepository.updateGoal(
          id: widget.goal!.id,
          title: _titleController.text.trim(),
          description: _descriptionController.text.trim().isEmpty
              ? null
              : _descriptionController.text.trim(),
          color: _color,
          ruleType: _ruleType.apiValue,
          metric: metric,
          targetValue: target,
          config: config,
          links: _isComposite ? const [] : links,
          dependencies: deps,
          recurrence: recurrence,
          deadline: deadline,
          startsAt: startsAtIso,
          confirmStartsAtChange: confirmLaterStart ? true : null,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final editing = widget.goal != null;

    return Scaffold(
      appBar: AppBar(
        title: Text(editing ? l10n.goalsFormEdit : l10n.goalsFormNew),
      ),
      body: _loading
          ? const LoadingView()
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.screen),
                children: [
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],
                  TextFormField(
                    controller: _titleController,
                    decoration: InputDecoration(labelText: l10n.goalsFormTitle),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? l10n.formTitleRequired : null,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  DropdownButtonFormField<GoalRuleType>(
                    value: _ruleType,
                    decoration: InputDecoration(labelText: l10n.goalsFormRuleType),
                    items: [
                      for (final type in GoalRuleType.values)
                        DropdownMenuItem(
                          value: type,
                          child: Text(_ruleLabel(type, l10n)),
                        ),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        _ruleType = v;
                        if (v == GoalRuleType.activityDuration ||
                            v == GoalRuleType.groupDuration ||
                            v == GoalRuleType.multiActivityDuration) {
                          _metric = GoalMetric.duration;
                        } else {
                          _metric = GoalMetric.count;
                        }
                      });
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextFormField(
                    controller: _targetController,
                    decoration: InputDecoration(
                      labelText: _metric == GoalMetric.duration
                          ? l10n.goalsFormTargetMinutes
                          : l10n.goalsFormTargetCount,
                    ),
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      final n = double.tryParse(v ?? '');
                      if (n == null || n <= 0) return l10n.goalsFormTargetInvalid;
                      return null;
                    },
                  ),
                  if (_needsActivities) ...[
                    const SizedBox(height: AppSpacing.lg),
                    Text(l10n.goalsFormLinkedActivities,
                        style: Theme.of(context).textTheme.titleSmall),
                    ..._activities.map(
                      (a) => CheckboxListTile(
                        dense: true,
                        value: _activityIds.contains(a.id),
                        title: Text(a.title),
                        onChanged: (checked) {
                          setState(() {
                            if (checked == true) {
                              _activityIds.add(a.id);
                            } else {
                              _activityIds.remove(a.id);
                            }
                          });
                        },
                      ),
                    ),
                  ],
                  if (_needsGroups) ...[
                    const SizedBox(height: AppSpacing.lg),
                    Text(l10n.goalsFormLinkedGroups,
                        style: Theme.of(context).textTheme.titleSmall),
                    ..._groups.map(
                      (g) => CheckboxListTile(
                        dense: true,
                        value: _groupIds.contains(g.id),
                        title: Text(g.name),
                        onChanged: (checked) {
                          setState(() {
                            if (checked == true) {
                              _groupIds.add(g.id);
                            } else {
                              _groupIds.remove(g.id);
                            }
                          });
                        },
                      ),
                    ),
                  ],
                  if (_isComposite) ...[
                    const SizedBox(height: AppSpacing.lg),
                    Text(l10n.goalsFormDependencies,
                        style: Theme.of(context).textTheme.titleSmall),
                    DropdownButtonFormField<String>(
                      value: _compositeMode,
                      decoration:
                          InputDecoration(labelText: l10n.goalsFormCompositeMode),
                      items: [
                        DropdownMenuItem(
                          value: 'all',
                          child: Text(l10n.goalsCompositeAll),
                        ),
                        DropdownMenuItem(
                          value: 'any',
                          child: Text(l10n.goalsCompositeAny),
                        ),
                        DropdownMenuItem(
                          value: 'weighted',
                          child: Text(l10n.goalsCompositeWeighted),
                        ),
                      ],
                      onChanged: (v) =>
                          setState(() => _compositeMode = v ?? 'all'),
                    ),
                    ..._otherGoals.map(
                      (g) => CheckboxListTile(
                        dense: true,
                        value: _dependencyIds.contains(g.id),
                        title: Text(g.title),
                        onChanged: (checked) {
                          setState(() {
                            if (checked == true) {
                              _dependencyIds.add(g.id);
                            } else {
                              _dependencyIds.remove(g.id);
                            }
                          });
                        },
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.md),
                  AdvancedFormSection(
                    key: _advancedKey,
                    initiallyExpanded: editing && _hasAdvancedValues,
                    hasConfiguredValues: _hasAdvancedValues,
                    children: [
                      TextFormField(
                        controller: _descriptionController,
                        decoration: InputDecoration(
                          labelText: l10n.formDescriptionOptional,
                        ),
                        maxLines: 2,
                        onChanged: (_) => setState(() {}),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Text(l10n.formGroupColor,
                          style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        children: [
                          for (final hex in kGroupColorPalette)
                            ChoiceChip(
                              label: const SizedBox(width: 12, height: 12),
                              selected:
                                  _color.toUpperCase() == hex.toUpperCase(),
                              selectedColor: Color(
                                int.parse(hex.replaceFirst('#', ''), radix: 16) +
                                    0xFF000000,
                              ),
                              backgroundColor: Color(
                                int.parse(hex.replaceFirst('#', ''), radix: 16) +
                                    0xFF000000,
                              ).withValues(alpha: 0.4),
                              onSelected: (_) => setState(() => _color = hex),
                            ),
                        ],
                      ),
                      if (!_isComposite) ...[
                        const SizedBox(height: AppSpacing.lg),
                        Text(l10n.goalsFormDependencies,
                            style: Theme.of(context).textTheme.titleSmall),
                        ..._otherGoals.map(
                          (g) => CheckboxListTile(
                            dense: true,
                            value: _dependencyIds.contains(g.id),
                            title: Text(g.title),
                            onChanged: (checked) {
                              setState(() {
                                if (checked == true) {
                                  _dependencyIds.add(g.id);
                                } else {
                                  _dependencyIds.remove(g.id);
                                }
                              });
                            },
                          ),
                        ),
                      ],
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l10n.goalsFormBlockUntilUnlocked),
                        value: _blockUntilUnlocked,
                        onChanged: (v) =>
                            setState(() => _blockUntilUnlocked = v),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(l10n.goalsFormStartsAt,
                          style: Theme.of(context).textTheme.titleSmall),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l10n.goalsFormStartsAtCustom),
                        subtitle: Text(l10n.goalsFormStartsAtHint),
                        value: _useCustomStart,
                        onChanged: (v) => setState(() {
                          _useCustomStart = v;
                          if (v && _startDate == null) {
                            _startDate = DateTime(
                              DateTime.now().year,
                              DateTime.now().month,
                              DateTime.now().day,
                            );
                          }
                        }),
                      ),
                      if (_useCustomStart) ...[
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            _startDate == null
                                ? l10n.formSelectDate
                                : '${_startDate!.year.toString().padLeft(4, '0')}-${_startDate!.month.toString().padLeft(2, '0')}-${_startDate!.day.toString().padLeft(2, '0')}',
                          ),
                          trailing: const Icon(Icons.calendar_today_outlined),
                          onTap: () async {
                            final picked = await showDatePicker(
                              context: context,
                              initialDate: _startDate ?? DateTime.now(),
                              firstDate: DateTime.now()
                                  .subtract(const Duration(days: 3650)),
                              lastDate: DateTime.now()
                                  .add(const Duration(days: 3650)),
                            );
                            if (picked != null) {
                              setState(() => _startDate = picked);
                            }
                          },
                        ),
                      ],
                      const SizedBox(height: AppSpacing.lg),
                      Text(l10n.goalsFormRecurrence,
                          style: Theme.of(context).textTheme.titleSmall),
                      DropdownButtonFormField<String?>(
                        value: _recurrencePeriod,
                        decoration: InputDecoration(
                            labelText: l10n.goalsFormRecurrencePeriod),
                        items: [
                          DropdownMenuItem(
                            value: null,
                            child: Text(l10n.goalsFormOneTime),
                          ),
                          DropdownMenuItem(
                            value: 'weekly',
                            child: Text(l10n.recurrenceWeekly),
                          ),
                          DropdownMenuItem(
                            value: 'monthly',
                            child: Text(l10n.recurrenceMonthly),
                          ),
                          DropdownMenuItem(
                            value: 'quarterly',
                            child: Text(l10n.goalsRecurrenceQuarterly),
                          ),
                          DropdownMenuItem(
                            value: 'every_x_days',
                            child: Text(l10n.recurrenceEveryXDays),
                          ),
                        ],
                        onChanged: (v) =>
                            setState(() => _recurrencePeriod = v),
                      ),
                      if (_recurrencePeriod != null) ...[
                        const SizedBox(height: AppSpacing.sm),
                        TextFormField(
                          initialValue: '$_recurrenceInterval',
                          decoration: InputDecoration(
                              labelText: l10n.goalsFormInterval),
                          keyboardType: TextInputType.number,
                          onChanged: (v) {
                            final n = int.tryParse(v);
                            if (n != null && n >= 1) _recurrenceInterval = n;
                          },
                        ),
                      ],
                      const SizedBox(height: AppSpacing.lg),
                      Text(l10n.goalsFormDeadline,
                          style: Theme.of(context).textTheme.titleSmall),
                      DropdownButtonFormField<String?>(
                        value: _deadlineKind,
                        decoration: InputDecoration(
                            labelText: l10n.goalsFormDeadlineKind),
                        items: [
                          DropdownMenuItem(
                            value: null,
                            child: Text(l10n.goalsFormNoDeadline),
                          ),
                          DropdownMenuItem(
                            value: 'absolute',
                            child: Text(l10n.goalsFormDeadlineAbsolute),
                          ),
                          DropdownMenuItem(
                            value: 'relative',
                            child: Text(l10n.goalsFormDeadlineRelative),
                          ),
                        ],
                        onChanged: (v) => setState(() => _deadlineKind = v),
                      ),
                      if (_deadlineKind == 'absolute') ...[
                        const SizedBox(height: AppSpacing.sm),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            _absoluteDeadline == null
                                ? l10n.formSelectDate
                                : _absoluteDeadline!
                                    .toIso8601String()
                                    .slice(0, 10),
                          ),
                          trailing: const Icon(Icons.calendar_today_outlined),
                          onTap: () async {
                            final picked = await showDatePicker(
                              context: context,
                              initialDate:
                                  _absoluteDeadline ?? DateTime.now(),
                              firstDate: DateTime.now()
                                  .subtract(const Duration(days: 1)),
                              lastDate: DateTime.now()
                                  .add(const Duration(days: 3650)),
                            );
                            if (picked != null) {
                              setState(() => _absoluteDeadline = picked);
                            }
                          },
                        ),
                      ],
                      if (_deadlineKind == 'relative') ...[
                        const SizedBox(height: AppSpacing.sm),
                        TextFormField(
                          initialValue: '$_relativeDeadlineDays',
                          decoration: InputDecoration(
                            labelText: l10n.goalsFormDeadlineDays,
                          ),
                          keyboardType: TextInputType.number,
                          onChanged: (v) {
                            final n = int.tryParse(v);
                            if (n != null && n >= 0) {
                              _relativeDeadlineDays = n;
                            }
                          },
                        ),
                      ],
                      if (editing && widget.rewardRepository != null) ...[
                        const SizedBox(height: AppSpacing.lg),
                        RewardRulesSection(
                          repository: widget.rewardRepository!,
                          sourceType: 'goal',
                          sourceId: widget.goal!.id,
                          wrapInCard: false,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: Text(
                      _saving
                          ? l10n.goalsFormSaving
                          : (editing ? l10n.formSaveChanges : l10n.formCreate),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  String _ruleLabel(GoalRuleType type, AppLocalizations l10n) {
    return switch (type) {
      GoalRuleType.activityCount => l10n.goalsRuleActivityCount,
      GoalRuleType.activityDuration => l10n.goalsRuleActivityDuration,
      GoalRuleType.groupDuration => l10n.goalsRuleGroupDuration,
      GoalRuleType.groupCount => l10n.goalsRuleGroupCount,
      GoalRuleType.groupAnyCount => l10n.goalsRuleGroupAnyCount,
      GoalRuleType.groupAllComplete => l10n.goalsRuleGroupAllComplete,
      GoalRuleType.multiActivityDuration => l10n.goalsRuleMultiDuration,
      GoalRuleType.streak => l10n.goalsRuleStreak,
      GoalRuleType.timeOfDayCount => l10n.goalsRuleTimeOfDay,
      GoalRuleType.composite => l10n.goalsRuleComposite,
    };
  }
}

extension on String {
  String slice(int start, int end) =>
      substring(start, end > length ? length : end);
}

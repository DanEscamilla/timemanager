import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../models/group.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import '../utils/recurrence_summary.dart';
import '../widgets/app_card.dart';

class ActivityFormScreen extends StatefulWidget {
  const ActivityFormScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    this.activity,
    this.initialDate,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;
  final Activity? activity;

  /// Prefills one-time date when creating from the calendar.
  final DateTime? initialDate;

  bool get isEditing => activity != null;

  @override
  State<ActivityFormScreen> createState() => _ActivityFormScreenState();
}

class _ActivityFormScreenState extends State<ActivityFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _intervalController;

  late TimeOfDay _startTime;
  late TimeOfDay _endTime;
  late bool _isRecurring;
  DateTime? _oneOffDate;
  late RecurrenceType _recurrenceType;
  DateTime? _recurrenceStartDate;
  DateTime? _recurrenceEndDate;
  late Set<int> _daysOfWeek;
  late Set<int> _daysOfMonth;
  late bool _isLastDayOfMonth;
  bool _saving = false;

  List<ActivityGroup> _groups = const [];
  int? _groupId;
  bool _groupsLoading = true;

  @override
  void initState() {
    super.initState();
    final activity = widget.activity;
    _titleController = TextEditingController(text: activity?.title ?? '');
    _descriptionController = TextEditingController(
      text: activity?.description ?? '',
    );
    _startTime = _parseTime(activity?.startTime ?? '09:00');
    _endTime = _parseTime(activity?.endTime ?? '10:00');
    _isRecurring = activity?.isRecurring ?? false;
    _groupId = activity?.groupId ?? activity?.group?.id;

    final pattern = activity?.recurrencePattern;
    _recurrenceType = pattern?.recurrenceType ?? RecurrenceType.weekly;
    _daysOfWeek = {...?pattern?.config.daysOfWeek};
    _daysOfMonth = {...?pattern?.config.daysOfMonth};
    _isLastDayOfMonth = pattern?.config.isLastDayOfMonth ?? false;
    _intervalController = TextEditingController(
      text: '${pattern?.config.intervalDays ?? 1}',
    );

    if (activity != null && !activity.isRecurring && activity.date != null) {
      _oneOffDate = _parseDateOnly(activity.date!);
    } else if (!_isRecurring) {
      _oneOffDate =
          widget.initialDate != null
              ? _dateOnly(widget.initialDate!)
              : _dateOnly(DateTime.now());
    }

    if (pattern != null) {
      _recurrenceStartDate = _parseDateOnly(pattern.config.startDate);
      if (pattern.config.endDate != null) {
        _recurrenceEndDate = _parseDateOnly(pattern.config.endDate!);
      }
    } else {
      _recurrenceStartDate = _dateOnly(DateTime.now());
    }

    _loadGroups();
  }

  Future<void> _loadGroups() async {
    try {
      final groups = await widget.groupRepository.fetchGroups();
      if (!mounted) return;
      setState(() {
        _groups = groups;
        _groupsLoading = false;
        // Drop a stale groupId if the group was deleted.
        if (_groupId != null &&
            !_groups.any((group) => group.id == _groupId)) {
          _groupId = null;
        }
      });
    } on GraphQLException {
      if (!mounted) return;
      setState(() => _groupsLoading = false);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _intervalController.dispose();
    super.dispose();
  }

  TimeOfDay _parseTime(String value) {
    final parts = value.split(':');
    return TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
  }

  String _formatTime(TimeOfDay time) {
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  DateTime _parseDateOnly(String value) {
    final parts = value.split('-');
    return DateTime(
      int.parse(parts[0]),
      int.parse(parts[1]),
      int.parse(parts[2]),
    );
  }

  String _formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  String _displayDate(DateTime date) {
    final locale = Localizations.localeOf(context).toString();
    return DateFormat.yMMMd(locale).format(date);
  }

  Future<void> _pickTime({required bool isStart}) async {
    final initial = isStart ? _startTime : _endTime;
    final picked = await showTimePicker(context: context, initialTime: initial);
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startTime = picked;
      } else {
        _endTime = picked;
      }
    });
  }

  Future<void> _pickDate({
    required DateTime? current,
    required ValueChanged<DateTime?> onPicked,
    bool allowClear = false,
  }) async {
    final initial = current ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null) {
      if (allowClear && current != null) {
        // Long-press / secondary clear is handled separately; ignore cancel.
      }
      return;
    }
    onPicked(_dateOnly(picked));
  }

  String? _validateSchedule(AppLocalizations l10n) {
    if (!_isRecurring) {
      if (_oneOffDate == null) return l10n.formDateRequired;
      return null;
    }

    if (_recurrenceStartDate == null) {
      return l10n.formRecurrenceStartRequired;
    }
    if (_recurrenceEndDate != null &&
        _recurrenceEndDate!.isBefore(_recurrenceStartDate!)) {
      return l10n.formEndDateAfterStart;
    }

    switch (_recurrenceType) {
      case RecurrenceType.weekly:
        if (_daysOfWeek.isEmpty) {
          return l10n.formSelectWeekday;
        }
      case RecurrenceType.monthly:
        if (_daysOfMonth.isEmpty && !_isLastDayOfMonth) {
          return l10n.formSelectMonthDay;
        }
      case RecurrenceType.everyXDays:
        final interval = int.tryParse(_intervalController.text.trim());
        if (interval == null || interval < 1) {
          return l10n.formIntervalInvalid;
        }
    }
    return null;
  }

  RecurrencePattern? _buildRecurrencePattern() {
    if (!_isRecurring) return null;

    return RecurrencePattern(
      recurrenceType: _recurrenceType,
      config: RecurrenceConfig(
        startDate: _formatDate(_recurrenceStartDate!),
        endDate:
            _recurrenceEndDate != null
                ? _formatDate(_recurrenceEndDate!)
                : null,
        daysOfWeek:
            _recurrenceType == RecurrenceType.weekly
                ? (_daysOfWeek.toList()..sort())
                : null,
        daysOfMonth:
            _recurrenceType == RecurrenceType.monthly && _daysOfMonth.isNotEmpty
                ? (_daysOfMonth.toList()..sort())
                : null,
        isLastDayOfMonth:
            _recurrenceType == RecurrenceType.monthly
                ? _isLastDayOfMonth
                : null,
        intervalDays:
            _recurrenceType == RecurrenceType.everyXDays
                ? int.parse(_intervalController.text.trim())
                : null,
      ),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    final l10n = AppLocalizations.of(context);
    final start = _formatTime(_startTime);
    final end = _formatTime(_endTime);
    if (_timeToMinutes(start) >= _timeToMinutes(end)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.formEndTimeAfterStart)),
      );
      return;
    }

    final scheduleError = _validateSchedule(l10n);
    if (scheduleError != null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(scheduleError)));
      return;
    }

    setState(() => _saving = true);

    try {
      final title = _titleController.text.trim();
      final description = _descriptionController.text.trim();
      final date =
          !_isRecurring && _oneOffDate != null
              ? _formatDate(_oneOffDate!)
              : null;
      final pattern = _buildRecurrencePattern();

      if (widget.isEditing) {
        await widget.repository.updateActivity(
          id: widget.activity!.id,
          title: title,
          description: description.isEmpty ? null : description,
          startTime: start,
          endTime: end,
          isRecurring: _isRecurring,
          date: date,
          recurrencePattern: pattern,
          groupId: _groupId,
        );
      } else {
        await widget.repository.createActivity(
          title: title,
          description: description.isEmpty ? null : description,
          startTime: start,
          endTime: end,
          isRecurring: _isRecurring,
          date: date,
          recurrencePattern: pattern,
          groupId: _groupId,
        );
      }

      if (!mounted) return;
      Navigator.pop(context, true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
      final errorL10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.localize(errorL10n))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  int _timeToMinutes(String time) {
    final parts = time.split(':');
    return int.parse(parts[0]) * 60 + int.parse(parts[1]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final weekdays = weekdayLabels(l10n);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.isEditing ? l10n.formEditActivity : l10n.formNewActivity,
        ),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.screen),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _titleController,
                    decoration: InputDecoration(
                      labelText: l10n.formTitle,
                    ),
                    textCapitalization: TextCapitalization.sentences,
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return l10n.formTitleRequired;
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextFormField(
                    controller: _descriptionController,
                    decoration: InputDecoration(
                      labelText: l10n.formDescriptionOptional,
                    ),
                    maxLines: 3,
                    textCapitalization: TextCapitalization.sentences,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _TimeField(
                    label: l10n.formStart,
                    time: _startTime,
                    onTap: () => _pickTime(isStart: true),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _TimeField(
                    label: l10n.formEnd,
                    time: _endTime,
                    onTap: () => _pickTime(isStart: false),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  if (_groupsLoading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
                      child: LinearProgressIndicator(),
                    )
                  else
                    DropdownButtonFormField<int?>(
                      value: _groupId,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: l10n.formGroup,
                      ),
                      items: [
                        DropdownMenuItem<int?>(
                          value: null,
                          child: Text(l10n.formNoGroup),
                        ),
                        for (final group in _groups)
                          DropdownMenuItem<int?>(
                            value: group.id,
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 12,
                                  height: 12,
                                  margin: const EdgeInsets.only(
                                    right: AppSpacing.sm,
                                  ),
                                  decoration: BoxDecoration(
                                    color: group.colorValue,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                Text(group.name),
                              ],
                            ),
                          ),
                      ],
                      onChanged: (value) => setState(() => _groupId = value),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      _isRecurring ? l10n.formRecurring : l10n.formOneTime,
                    ),
                    subtitle: Text(
                      _isRecurring
                          ? l10n.formRepeatsOnSchedule
                          : l10n.formHappensOnSingleDate,
                    ),
                    value: _isRecurring,
                    onChanged: (value) => setState(() => _isRecurring = value),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (!_isRecurring) ...[
                    _DateField(
                      label: l10n.formDate,
                      value: _oneOffDate == null
                          ? l10n.formSelectDate
                          : _displayDate(_oneOffDate!),
                      onTap: () => _pickDate(
                        current: _oneOffDate,
                        onPicked: (picked) =>
                            setState(() => _oneOffDate = picked),
                      ),
                    ),
                  ] else ...[
                    DropdownButtonFormField<RecurrenceType>(
                      value: _recurrenceType,
                      decoration: InputDecoration(
                        labelText: l10n.formRepeats,
                      ),
                      items: RecurrenceType.values
                          .map(
                            (type) => DropdownMenuItem(
                              value: type,
                              child: Text(recurrenceTypeLabel(type, l10n)),
                            ),
                          )
                          .toList(),
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _recurrenceType = value);
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _DateField(
                      label: l10n.formStarts,
                      value: _recurrenceStartDate == null
                          ? l10n.formSelectStartDate
                          : _displayDate(_recurrenceStartDate!),
                      onTap: () => _pickDate(
                        current: _recurrenceStartDate,
                        onPicked: (picked) =>
                            setState(() => _recurrenceStartDate = picked),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    _DateField(
                      label: l10n.formEndsOptional,
                      value: _recurrenceEndDate == null
                          ? l10n.formNoEndDate
                          : _displayDate(_recurrenceEndDate!),
                      onTap: () => _pickDate(
                        current: _recurrenceEndDate ?? _recurrenceStartDate,
                        onPicked: (picked) =>
                            setState(() => _recurrenceEndDate = picked),
                      ),
                      trailing: _recurrenceEndDate == null
                          ? null
                          : IconButton(
                              tooltip: l10n.formClearEndDate,
                              onPressed: () =>
                                  setState(() => _recurrenceEndDate = null),
                              icon: const Icon(Icons.clear),
                            ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (_recurrenceType == RecurrenceType.weekly) ...[
                      Text(
                        l10n.formDaysOfWeek,
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: List.generate(7, (index) {
                          final selected = _daysOfWeek.contains(index);
                          return FilterChip(
                            label: Text(weekdays[index]),
                            selected: selected,
                            onSelected: (value) {
                              setState(() {
                                if (value) {
                                  _daysOfWeek.add(index);
                                } else {
                                  _daysOfWeek.remove(index);
                                }
                              });
                            },
                          );
                        }),
                      ),
                    ],
                    if (_recurrenceType == RecurrenceType.monthly) ...[
                      Text(
                        l10n.formDaysOfMonth,
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: List.generate(31, (index) {
                          final day = index + 1;
                          final selected = _daysOfMonth.contains(day);
                          return FilterChip(
                            label: Text('$day'),
                            selected: selected,
                            visualDensity: VisualDensity.compact,
                            onSelected: (value) {
                              setState(() {
                                if (value) {
                                  _daysOfMonth.add(day);
                                } else {
                                  _daysOfMonth.remove(day);
                                }
                              });
                            },
                          );
                        }),
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l10n.formLastDayOfMonth),
                        value: _isLastDayOfMonth,
                        onChanged: (value) {
                          setState(() => _isLastDayOfMonth = value ?? false);
                        },
                      ),
                    ],
                    if (_recurrenceType == RecurrenceType.everyXDays) ...[
                      TextFormField(
                        controller: _intervalController,
                        decoration: InputDecoration(
                          labelText: l10n.formRepeatEveryNDays,
                        ),
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        validator: (value) {
                          if (!_isRecurring ||
                              _recurrenceType != RecurrenceType.everyXDays) {
                            return null;
                          }
                          final parsed = int.tryParse(value?.trim() ?? '');
                          if (parsed == null || parsed < 1) {
                            return l10n.formIntervalAtLeastOne;
                          }
                          return null;
                        },
                      ),
                    ],
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      widget.isEditing
                          ? l10n.formSaveChanges
                          : l10n.formCreate,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({
    required this.label,
    required this.time,
    required this.onTap,
  });

  final String label;
  final TimeOfDay time;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final formatted = time.format(context);
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.borderMd,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: const Icon(Icons.schedule),
        ),
        child: Text(formatted),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
    this.trailing,
  });

  final String label;
  final String value;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.borderMd,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: trailing ?? const Icon(Icons.calendar_today),
        ),
        child: Text(value),
      ),
    );
  }
}

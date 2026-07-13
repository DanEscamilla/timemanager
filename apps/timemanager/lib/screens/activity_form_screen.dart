import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';

class ActivityFormScreen extends StatefulWidget {
  const ActivityFormScreen({
    super.key,
    required this.repository,
    this.activity,
    this.initialDate,
  });

  final ActivityRepository repository;
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

  static const _weekdayLabels = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ];

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
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
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

  String? _validateSchedule() {
    if (!_isRecurring) {
      if (_oneOffDate == null)
        return 'Date is required for one-time activities';
      return null;
    }

    if (_recurrenceStartDate == null) {
      return 'Recurrence start date is required';
    }
    if (_recurrenceEndDate != null &&
        _recurrenceEndDate!.isBefore(_recurrenceStartDate!)) {
      return 'End date must be on or after start date';
    }

    switch (_recurrenceType) {
      case RecurrenceType.weekly:
        if (_daysOfWeek.isEmpty) {
          return 'Select at least one day of the week';
        }
      case RecurrenceType.monthly:
        if (_daysOfMonth.isEmpty && !_isLastDayOfMonth) {
          return 'Select at least one day of the month, or last day';
        }
      case RecurrenceType.everyXDays:
        final interval = int.tryParse(_intervalController.text.trim());
        if (interval == null || interval < 1) {
          return 'Interval must be an integer of at least 1';
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

    final start = _formatTime(_startTime);
    final end = _formatTime(_endTime);
    if (_timeToMinutes(start) >= _timeToMinutes(end)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('End time must be after start time')),
      );
      return;
    }

    final scheduleError = _validateSchedule();
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
        );
      }

      if (!mounted) return;
      Navigator.pop(context, true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
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
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEditing ? 'Edit activity' : 'New activity'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Title',
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.sentences,
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Title is required';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'Description (optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 16),
            _TimeField(
              label: 'Start',
              time: _startTime,
              onTap: () => _pickTime(isStart: true),
            ),
            const SizedBox(height: 12),
            _TimeField(
              label: 'End',
              time: _endTime,
              onTap: () => _pickTime(isStart: false),
            ),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(_isRecurring ? 'Recurring' : 'One-time'),
              subtitle: Text(
                _isRecurring
                    ? 'Repeats on a schedule'
                    : 'Happens on a single date',
              ),
              value: _isRecurring,
              onChanged: (value) => setState(() => _isRecurring = value),
            ),
            const SizedBox(height: 8),
            if (!_isRecurring) ...[
              _DateField(
                label: 'Date',
                value:
                    _oneOffDate == null
                        ? 'Select date'
                        : _displayDate(_oneOffDate!),
                onTap:
                    () => _pickDate(
                      current: _oneOffDate,
                      onPicked:
                          (picked) => setState(() => _oneOffDate = picked),
                    ),
              ),
            ] else ...[
              DropdownButtonFormField<RecurrenceType>(
                value: _recurrenceType,
                decoration: const InputDecoration(
                  labelText: 'Repeats',
                  border: OutlineInputBorder(),
                ),
                items:
                    RecurrenceType.values
                        .map(
                          (type) => DropdownMenuItem(
                            value: type,
                            child: Text(type.label),
                          ),
                        )
                        .toList(),
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => _recurrenceType = value);
                },
              ),
              const SizedBox(height: 12),
              _DateField(
                label: 'Starts',
                value:
                    _recurrenceStartDate == null
                        ? 'Select start date'
                        : _displayDate(_recurrenceStartDate!),
                onTap:
                    () => _pickDate(
                      current: _recurrenceStartDate,
                      onPicked:
                          (picked) =>
                              setState(() => _recurrenceStartDate = picked),
                    ),
              ),
              const SizedBox(height: 12),
              _DateField(
                label: 'Ends (optional)',
                value:
                    _recurrenceEndDate == null
                        ? 'No end date'
                        : _displayDate(_recurrenceEndDate!),
                onTap:
                    () => _pickDate(
                      current: _recurrenceEndDate ?? _recurrenceStartDate,
                      onPicked:
                          (picked) =>
                              setState(() => _recurrenceEndDate = picked),
                    ),
                trailing:
                    _recurrenceEndDate == null
                        ? null
                        : IconButton(
                          tooltip: 'Clear end date',
                          onPressed:
                              () => setState(() => _recurrenceEndDate = null),
                          icon: const Icon(Icons.clear),
                        ),
              ),
              const SizedBox(height: 16),
              if (_recurrenceType == RecurrenceType.weekly) ...[
                Text(
                  'Days of week',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: List.generate(7, (index) {
                    final selected = _daysOfWeek.contains(index);
                    return FilterChip(
                      label: Text(_weekdayLabels[index]),
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
                  'Days of month',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
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
                  title: const Text('Last day of month'),
                  value: _isLastDayOfMonth,
                  onChanged: (value) {
                    setState(() => _isLastDayOfMonth = value ?? false);
                  },
                ),
              ],
              if (_recurrenceType == RecurrenceType.everyXDays) ...[
                TextFormField(
                  controller: _intervalController,
                  decoration: const InputDecoration(
                    labelText: 'Repeat every N days',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (value) {
                    if (!_isRecurring ||
                        _recurrenceType != RecurrenceType.everyXDays) {
                      return null;
                    }
                    final parsed = int.tryParse(value?.trim() ?? '');
                    if (parsed == null || parsed < 1) {
                      return 'Enter an integer of at least 1';
                    }
                    return null;
                  },
                ),
              ],
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _saving ? null : _save,
              child:
                  _saving
                      ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                      : Text(widget.isEditing ? 'Save changes' : 'Create'),
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
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
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
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: trailing ?? const Icon(Icons.calendar_today),
        ),
        child: Text(value),
      ),
    );
  }
}

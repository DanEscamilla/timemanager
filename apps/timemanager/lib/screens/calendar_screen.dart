import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../models/goal.dart';
import '../services/activity_repository.dart';
import '../services/goal_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_icon_sizes.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import '../utils/calendar_event_mapper.dart';
import '../utils/completion_lookup.dart';
import '../utils/occurrence_expander.dart';
import '../utils/recurrence_summary.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import 'activity_form_screen.dart';

enum CalendarViewMode { day, week, month }

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    required this.completionRepository,
    this.onChanged,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;
  final CompletionRepository completionRepository;

  /// Called after a successful create/update so siblings can refresh.
  final VoidCallback? onChanged;

  @override
  State<CalendarScreen> createState() => CalendarScreenState();
}

class CalendarScreenState extends State<CalendarScreen> {
  late Future<List<Activity>> _activitiesFuture;
  late DateTime _selectedDate;
  CalendarViewMode _viewMode = CalendarViewMode.day;

  final EventController<Activity> _eventController =
      EventController<Activity>();
  final GlobalKey<DayViewState<Activity>> _dayKey =
      GlobalKey<DayViewState<Activity>>();
  final GlobalKey<WeekViewState<Activity>> _weekKey =
      GlobalKey<WeekViewState<Activity>>();
  final GlobalKey<MonthViewState<Activity>> _monthKey =
      GlobalKey<MonthViewState<Activity>>();

  List<Activity> _activities = const [];
  Map<String, ActivityCompletion> _completionsByKey = {};

  @override
  void initState() {
    super.initState();
    _selectedDate = _dateOnly(DateTime.now());
    reload();
  }

  @override
  void dispose() {
    _eventController.dispose();
    super.dispose();
  }

  DateTime get selectedDate => _selectedDate;

  DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  ({DateTime from, DateTime to}) _syncRange() {
    final from = DateTime(
      _selectedDate.year,
      _selectedDate.month - 2,
      _selectedDate.day,
    );
    final to = DateTime(
      _selectedDate.year,
      _selectedDate.month + 2,
      _selectedDate.day,
    );
    return (from: from, to: to);
  }

  void reload() {
    setState(() {
      _activitiesFuture = _loadActivities();
    });
  }

  Future<List<Activity>> _loadActivities() async {
    final activities = await widget.repository.fetchActivities();
    _activities = activities;
    await _syncEvents();
    return activities;
  }

  Future<void> _syncEvents({bool refreshCompletions = true}) async {
    if (!mounted) return;
    final colorScheme = Theme.of(context).colorScheme;
    final range = _syncRange();

    if (refreshCompletions) {
      try {
        final completions = await widget.completionRepository.fetchCompletions(
          fromDate: dateToIso(range.from),
          toDate: dateToIso(range.to),
        );
        if (!mounted) return;
        _completionsByKey = indexCompletions(completions);
      } catch (_) {
        // Keep the last known map if a refresh fails mid-navigation.
      }
    }

    final occurrences = expandOccurrences(
      activities: _activities,
      from: range.from,
      to: range.to,
    );
    final events = toCalendarEvents(
      occurrences,
      oneOffColor: colorScheme.primary,
      recurringColor: colorScheme.tertiary,
    );
    _eventController
      ..clear()
      ..addAll(events);
    if (mounted) setState(() {});
  }

  void _onFocusedDateChanged(DateTime date) {
    final next = _dateOnly(date);
    if (next == _selectedDate) return;
    setState(() => _selectedDate = next);
    _syncEvents();
  }

  void _goToDayView(DateTime date) {
    setState(() {
      _selectedDate = _dateOnly(date);
      _viewMode = CalendarViewMode.day;
    });
    _syncEvents();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _dayKey.currentState?.jumpToDate(_selectedDate);
    });
  }

  Future<void> openCreateForSelectedDay() =>
      _openForm(initialDate: _selectedDate);

  Future<void> _openForm({Activity? activity, DateTime? initialDate}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder:
            (_) => ActivityFormScreen(
              repository: widget.repository,
              groupRepository: widget.groupRepository,
              activity: activity,
              initialDate: initialDate,
            ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  ActivityCompletion? _completionFor(Activity activity, DateTime date) {
    return _completionsByKey[completionKey(activity.id, dateToIso(date))];
  }

  Future<void> _onEventTap(
    List<CalendarEventData<Activity>> events,
    DateTime date,
  ) async {
    if (events.isEmpty) return;
    final activity = events.first.event;
    if (activity == null) return;
    final occurrenceDate = _dateOnly(events.first.date);
    await _showEventActions(activity: activity, occurrenceDate: occurrenceDate);
  }

  Future<void> _showEventActions({
    required Activity activity,
    required DateTime occurrenceDate,
  }) async {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final completion = _completionFor(activity, occurrenceDate);
    final done = completion != null;
    final locale = Localizations.localeOf(context).toString();
    final dateLabel = DateFormat.yMMMd(locale).format(occurrenceDate);
    final scheduleLabel = l10n.scheduleDateTimeRange(
      dateLabel,
      activity.startTime,
      activity.endTime,
    );
    final accent =
        activity.group?.colorValue ??
        (activity.isRecurring ? colorScheme.tertiary : colorScheme.primary);

    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.xs,
                  AppSpacing.md,
                  AppSpacing.sm,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 4,
                      height: 48,
                      margin: const EdgeInsets.only(right: AppSpacing.md),
                      decoration: BoxDecoration(
                        color: accent,
                        borderRadius: AppRadius.borderPill,
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            activity.title,
                            style: theme.textTheme.titleMedium?.copyWith(
                              decoration:
                                  done
                                      ? TextDecoration.lineThrough
                                      : TextDecoration.none,
                              decorationColor: colorScheme.onSurface,
                              decorationThickness: 2,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            scheduleLabel,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                          if (activity.group != null) ...[
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              activity.group!.name,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: accent,
                              ),
                            ),
                          ],
                          if (activity.description?.isNotEmpty == true) ...[
                            const SizedBox(height: AppSpacing.xs),
                            Text(
                              activity.description!,
                              style: theme.textTheme.bodySmall,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                          if (done || activity.isRecurring) ...[
                            const SizedBox(height: AppSpacing.sm),
                            Wrap(
                              spacing: AppSpacing.xs,
                              runSpacing: AppSpacing.xs,
                              children: [
                                if (done)
                                  Chip(
                                    avatar: Icon(
                                      Icons.check_circle,
                                      size: AppIconSizes.sm,
                                      color: colorScheme.primary,
                                    ),
                                    label: Text(l10n.overviewCompletedBadge),
                                    visualDensity: VisualDensity.compact,
                                    materialTapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                                if (activity.isRecurring)
                                  Chip(
                                    label: Text(
                                      activity.recurrencePattern != null
                                          ? recurrenceTypeLabel(
                                            activity
                                                .recurrencePattern!
                                                .recurrenceType,
                                            l10n,
                                          )
                                          : l10n.activitiesRecurring,
                                    ),
                                    visualDensity: VisualDensity.compact,
                                    materialTapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.edit_outlined),
                title: Text(l10n.activitiesEdit),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  _openForm(activity: activity);
                },
              ),
              if (done)
                ListTile(
                  leading: const Icon(Icons.undo),
                  title: Text(l10n.overviewUndoDone),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    _undoDone(completion);
                  },
                )
              else
                ListTile(
                  leading: const Icon(Icons.check),
                  title: Text(l10n.overviewMarkDone),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    _markDone(activity, occurrenceDate);
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _markDone(Activity activity, DateTime occurrenceDate) async {
    final iso = dateToIso(occurrenceDate);
    try {
      final completion = await widget.completionRepository.completeActivity(
        activityId: activity.id,
        occurrenceDate: iso,
      );
      if (!mounted) return;
      _completionsByKey[completionKey(activity.id, iso)] = completion;
      await _syncEvents(refreshCompletions: false);
      widget.onChanged?.call();
    } catch (error) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_errorMessage(error, l10n))));
    }
  }

  Future<void> _undoDone(ActivityCompletion completion) async {
    try {
      await widget.completionRepository.undoCompletion(completion.id);
      if (!mounted) return;
      _completionsByKey.remove(
        completionKey(completion.activityId, completion.occurrenceDate),
      );
      await _syncEvents(refreshCompletions: false);
      widget.onChanged?.call();
    } catch (error) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_errorMessage(error, l10n))));
    }
  }

  HeaderStyle _headerStyle(ColorScheme colorScheme, TextTheme textTheme) {
    return HeaderStyle(
      headerTextStyle: textTheme.titleMedium?.copyWith(
        color: colorScheme.onSurface,
      ),
      decoration: BoxDecoration(color: colorScheme.surface),
      leftIconConfig: IconDataConfig(
        color: colorScheme.onSurfaceVariant,
        size: 24,
      ),
      rightIconConfig: IconDataConfig(
        color: colorScheme.onSurfaceVariant,
        size: 24,
      ),
    );
  }

  /// Content-sized width for the hour timeline.
  ///
  /// [DayView]/[WeekView] default to 13% of the view width, which is too wide
  /// on large screens. Measure against the default label style instead.
  double _timeLineWidth(BuildContext context) {
    // Matches calendar_view's DefaultTimeLineMark (fontSize 15, padding 7+7).
    const style = TextStyle(fontSize: 15);
    const horizontalPadding = 14.0;
    const samples = ['10 am -', '10 pm -'];
    final scaler = MediaQuery.textScalerOf(context);
    var maxWidth = 0.0;
    for (final sample in samples) {
      final painter = TextPainter(
        text: TextSpan(text: sample, style: style),
        textDirection: TextDirection.ltr,
        textScaler: scaler,
      )..layout();
      if (painter.width > maxWidth) maxWidth = painter.width;
    }
    return maxWidth + horizontalPadding;
  }

  Widget _eventTileBuilder(
    DateTime date,
    List<CalendarEventData<Activity>> events,
    Rect boundary,
    DateTime startDuration,
    DateTime endDuration,
  ) {
    final event = events.first;
    final activity = event.event;
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isRecurring = activity?.isRecurring ?? false;
    final onEvent =
        activity?.group != null
            ? _contrastingOnColor(event.color)
            : (isRecurring ? colorScheme.onTertiary : colorScheme.onPrimary);
    final timeLabel =
        '${activity?.startTime ?? ''} – ${activity?.endTime ?? ''}';
    final done =
        activity != null && _completionFor(activity, event.date) != null;
    final showTime = boundary.height >= 40;
    final extraCount = events.length - 1;

    final tile = Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: event.color,
        borderRadius: AppRadius.borderSm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            event.title,
            maxLines: showTime ? 2 : 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.labelMedium?.copyWith(
              color: onEvent,
              decoration:
                  done ? TextDecoration.lineThrough : TextDecoration.none,
              decorationColor: onEvent,
              decorationThickness: 2,
            ),
          ),
          if (showTime) ...[
            const SizedBox(height: 2),
            Text(
              timeLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: textTheme.labelSmall?.copyWith(
                color: onEvent.withValues(alpha: 0.9),
              ),
            ),
          ],
          if (extraCount > 0)
            Text(
              '+$extraCount',
              style: textTheme.labelSmall?.copyWith(
                color: onEvent.withValues(alpha: 0.9),
              ),
            ),
        ],
      ),
    );

    if (!done) return tile;

    return Opacity(
      opacity: 0.72,
      child: Stack(
        children: [
          Positioned.fill(child: tile),
          Positioned(
            top: 2,
            right: 2,
            child: Icon(
              Icons.check_circle,
              size: AppIconSizes.xs,
              color: onEvent,
            ),
          ),
        ],
      ),
    );
  }

  /// Readable foreground for a solid group/event color.
  Color _contrastingOnColor(Color background) {
    return background.computeLuminance() > 0.5 ? Colors.black87 : Colors.white;
  }

  Widget _buildViewSwitcher() {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.xs,
      ),
      child: SegmentedButton<CalendarViewMode>(
        segments: [
          ButtonSegment(
            value: CalendarViewMode.day,
            label: Text(l10n.calendarDay),
            icon: const Icon(Icons.view_day_outlined, size: AppIconSizes.sm),
          ),
          ButtonSegment(
            value: CalendarViewMode.week,
            label: Text(l10n.calendarWeek),
            icon: const Icon(Icons.view_week_outlined, size: AppIconSizes.sm),
          ),
          ButtonSegment(
            value: CalendarViewMode.month,
            label: Text(l10n.calendarMonth),
            icon: const Icon(
              Icons.calendar_view_month_outlined,
              size: AppIconSizes.sm,
            ),
          ),
        ],
        selected: {_viewMode},
        onSelectionChanged: (selected) {
          setState(() => _viewMode = selected.single);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            switch (_viewMode) {
              case CalendarViewMode.day:
                _dayKey.currentState?.jumpToDate(_selectedDate);
              case CalendarViewMode.week:
                _weekKey.currentState?.jumpToWeek(_selectedDate);
              case CalendarViewMode.month:
                _monthKey.currentState?.jumpToMonth(_selectedDate);
            }
          });
        },
      ),
    );
  }

  Widget _buildCalendar(ColorScheme colorScheme, TextTheme textTheme) {
    final headerStyle = _headerStyle(colorScheme, textTheme);
    final hourLineColor = colorScheme.outlineVariant;
    final timeLineWidth = _timeLineWidth(context);

    switch (_viewMode) {
      case CalendarViewMode.day:
        return DayView<Activity>(
          key: _dayKey,
          controller: _eventController,
          initialDay: _selectedDate,
          heightPerMinute: 1.2,
          startDuration: const Duration(hours: 7),
          timeLineWidth: timeLineWidth,
          headerStyle: headerStyle,
          backgroundColor: colorScheme.surface,
          hourIndicatorSettings: HourIndicatorSettings(color: hourLineColor),
          liveTimeIndicatorSettings: LiveTimeIndicatorSettings(
            color: colorScheme.error,
          ),
          eventTileBuilder: _eventTileBuilder,
          onPageChange: (date, _) => _onFocusedDateChanged(date),
          onEventTap: _onEventTap,
          onDateTap: (date) {
            setState(() => _selectedDate = _dateOnly(date));
          },
        );
      case CalendarViewMode.week:
        return WeekView<Activity>(
          key: _weekKey,
          controller: _eventController,
          initialDay: _selectedDate,
          heightPerMinute: 1.0,
          scrollOffset: 7 * 60 * 1.0, // start near 7am
          startDay: WeekDays.monday,
          timeLineWidth: timeLineWidth,
          headerStyle: headerStyle,
          backgroundColor: colorScheme.surface,
          hourIndicatorSettings: HourIndicatorSettings(color: hourLineColor),
          liveTimeIndicatorSettings: LiveTimeIndicatorSettings(
            color: colorScheme.error,
          ),
          eventTileBuilder: _eventTileBuilder,
          onPageChange: (date, _) => _onFocusedDateChanged(date),
          onEventTap: _onEventTap,
          onDateTap: (date) => _goToDayView(date),
        );
      case CalendarViewMode.month:
        return MonthView<Activity>(
          key: _monthKey,
          controller: _eventController,
          monthViewStyle: MonthViewStyle(
            initialMonth: _selectedDate,
            headerStyle: headerStyle,
            startDay: WeekDays.monday,
            useAvailableVerticalSpace: true,
            hideDaysNotInMonth: true,
            borderColor: colorScheme.outlineVariant,
          ),
          monthViewThemeSettings: MonthViewThemeSettings(
            headerStyle: headerStyle,
            weekDayBorderColor: colorScheme.outlineVariant,
            weekDayBackgroundColor: colorScheme.surfaceContainerLow,
            weekDayTextStyle: textTheme.labelMedium?.copyWith(
              color: colorScheme.onSurfaceVariant,
            ),
            cellsInMonthHighlightColor: colorScheme.primary,
            cellsInMonthHighlightedTitleColor: colorScheme.onPrimary,
            cellsInMonthTileColor: colorScheme.primary,
          ),
          // MonthView's monthViewBuilders field is declared as MonthViewBuilders
          // (i.e. MonthViewBuilders<Object?>), not MonthViewBuilders<T>. Passing
          // Activity-typed callbacks crashes on web (function types are
          // contravariant). Keep builders untyped and cast event payloads.
          monthViewBuilders: MonthViewBuilders(
            onPageChange: (date, _) => _onFocusedDateChanged(date),
            onCellTap: (events, date) => _goToDayView(date),
            onEventTap: (event, date) {
              final activity = event.event;
              if (activity is! Activity) return;
              _showEventActions(
                activity: activity,
                occurrenceDate: _dateOnly(date),
              );
            },
          ),
        );
    }
  }

  Widget _buildBody() {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final textTheme = theme.textTheme;

    return Column(
      children: [
        _buildViewSwitcher(),
        Expanded(
          child: FutureBuilder<List<Activity>>(
            future: _activitiesFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting &&
                  _activities.isEmpty) {
                return const LoadingView();
              }

              if (snapshot.hasError && _activities.isEmpty) {
                final l10n = AppLocalizations.of(context);
                return ErrorState(
                  message: _errorMessage(snapshot.error, l10n),
                  onRetry: reload,
                );
              }

              return CalendarControllerProvider<Activity>(
                controller: _eventController,
                child: _buildCalendar(colorScheme, textTheme),
              );
            },
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => _buildBody();

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }
}

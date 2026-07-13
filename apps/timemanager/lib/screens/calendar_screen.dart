import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_icon_sizes.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import '../utils/calendar_event_mapper.dart';
import '../utils/occurrence_expander.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import 'activity_form_screen.dart';

enum CalendarViewMode { day, week, month }

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({
    super.key,
    required this.repository,
    required this.groupRepository,
    this.onChanged,
  });

  final ActivityRepository repository;
  final GroupRepository groupRepository;

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

  void reload() {
    setState(() {
      _activitiesFuture = widget.repository.fetchActivities().then((
        activities,
      ) {
        _activities = activities;
        _syncEvents();
        return activities;
      });
    });
  }

  void _syncEvents() {
    if (!mounted) return;
    final colorScheme = Theme.of(context).colorScheme;
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
    final occurrences = expandOccurrences(
      activities: _activities,
      from: from,
      to: to,
    );
    final events = toCalendarEvents(
      occurrences,
      oneOffColor: colorScheme.primary,
      recurringColor: colorScheme.tertiary,
    );
    _eventController
      ..clear()
      ..addAll(events);
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

  void _onEventTap(List<CalendarEventData<Activity>> events, DateTime date) {
    if (events.isEmpty) return;
    final activity = events.first.event;
    if (activity == null) return;
    _openForm(activity: activity);
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
    final onEvent = isRecurring ? colorScheme.onTertiary : colorScheme.onPrimary;
    final timeLabel =
        '${activity?.startTime ?? ''} – ${activity?.endTime ?? ''}';
    return RoundedEventTile(
      title: event.title,
      description: timeLabel,
      backgroundColor: event.color,
      borderRadius: AppRadius.borderSm,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      titleStyle: textTheme.labelMedium?.copyWith(color: onEvent),
      descriptionStyle: textTheme.labelSmall?.copyWith(
        color: onEvent.withValues(alpha: 0.9),
      ),
      totalEvents: events.length - 1,
    );
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

    switch (_viewMode) {
      case CalendarViewMode.day:
        return DayView<Activity>(
          key: _dayKey,
          controller: _eventController,
          initialDay: _selectedDate,
          heightPerMinute: 1.2,
          startDuration: const Duration(hours: 7),
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
              _openForm(activity: activity);
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

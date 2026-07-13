import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';

import '../models/activity.dart';
import '../services/activity_repository.dart';
import '../services/graphql_client.dart';
import '../utils/calendar_event_mapper.dart';
import '../utils/occurrence_expander.dart';
import 'activity_form_screen.dart';

enum CalendarViewMode { day, week, month }

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({
    super.key,
    required this.repository,
    this.embedded = false,
    this.onChanged,
  });

  final ActivityRepository repository;

  /// When embedded in [HomeScreen], render body only (shell owns chrome).
  final bool embedded;

  /// Called after a successful create/update so siblings can refresh.
  final VoidCallback? onChanged;

  @override
  State<CalendarScreen> createState() => CalendarScreenState();
}

class CalendarScreenState extends State<CalendarScreen> {
  late Future<List<Activity>> _activitiesFuture;
  late DateTime _selectedDate;
  CalendarViewMode _viewMode = CalendarViewMode.day;

  final EventController<Activity> _eventController = EventController<Activity>();
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
      _activitiesFuture = widget.repository.fetchActivities().then((activities) {
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
        builder: (_) => ActivityFormScreen(
          repository: widget.repository,
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
    final timeLabel =
        '${activity?.startTime ?? ''} – ${activity?.endTime ?? ''}';
    return RoundedEventTile(
      title: event.title,
      description: timeLabel,
      backgroundColor: event.color,
      borderRadius: BorderRadius.circular(6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      titleStyle: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
      descriptionStyle: TextStyle(
        fontSize: 10,
        color: Colors.white.withValues(alpha: 0.9),
      ),
      totalEvents: events.length - 1,
    );
  }

  Widget _buildViewSwitcher() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: SegmentedButton<CalendarViewMode>(
        segments: const [
          ButtonSegment(
            value: CalendarViewMode.day,
            label: Text('Day'),
            icon: Icon(Icons.view_day_outlined, size: 18),
          ),
          ButtonSegment(
            value: CalendarViewMode.week,
            label: Text('Week'),
            icon: Icon(Icons.view_week_outlined, size: 18),
          ),
          ButtonSegment(
            value: CalendarViewMode.month,
            label: Text('Month'),
            icon: Icon(Icons.calendar_view_month_outlined, size: 18),
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
          monthViewBuilders: MonthViewBuilders<Activity>(
            onPageChange: (date, _) => _onFocusedDateChanged(date),
            onCellTap: (events, date) => _goToDayView(date),
            onEventTap: (event, date) {
              final activity = event.event;
              if (activity == null) return;
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
                return const Center(child: CircularProgressIndicator());
              }

              if (snapshot.hasError && _activities.isEmpty) {
                return _ErrorState(
                  message: _errorMessage(snapshot.error),
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
  Widget build(BuildContext context) {
    final body = _buildBody();
    if (widget.embedded) return body;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendar'),
      ),
      body: body,
      floatingActionButton: FloatingActionButton(
        onPressed: openCreateForSelectedDay,
        tooltip: 'Add activity for this day',
        child: const Icon(Icons.add),
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error is GraphQLException) return error.message;
    return error?.toString() ?? 'Unknown error';
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off,
              size: 48,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              'Could not load activities',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

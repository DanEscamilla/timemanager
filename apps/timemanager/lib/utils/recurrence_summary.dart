import '../l10n/app_localizations.dart';
import '../models/activity.dart';

List<String> weekdayLabels(AppLocalizations l10n) => [
      l10n.weekdaySun,
      l10n.weekdayMon,
      l10n.weekdayTue,
      l10n.weekdayWed,
      l10n.weekdayThu,
      l10n.weekdayFri,
      l10n.weekdaySat,
    ];

String recurrenceTypeLabel(RecurrenceType type, AppLocalizations l10n) =>
    switch (type) {
      RecurrenceType.weekly => l10n.recurrenceWeekly,
      RecurrenceType.monthly => l10n.recurrenceMonthly,
      RecurrenceType.everyXDays => l10n.recurrenceEveryXDays,
    };

/// Short human-readable schedule label for list/calendar rows.
String formatActivitySchedule(Activity activity, AppLocalizations l10n) {
  if (!activity.isRecurring) {
    final date = activity.date;
    if (date == null) {
      return l10n.scheduleTimeRange(activity.startTime, activity.endTime);
    }
    return l10n.scheduleDateTimeRange(
      date,
      activity.startTime,
      activity.endTime,
    );
  }

  final summary = formatRecurrenceSummary(activity.recurrencePattern, l10n);
  return l10n.scheduleSummaryTimeRange(
    summary,
    activity.startTime,
    activity.endTime,
  );
}

String formatRecurrenceSummary(
  RecurrencePattern? pattern,
  AppLocalizations l10n,
) {
  if (pattern == null) return l10n.activitiesRecurring;

  final config = pattern.config;
  final weekdays = weekdayLabels(l10n);
  switch (pattern.recurrenceType) {
    case RecurrenceType.weekly:
      final days = config.daysOfWeek ?? const <int>[];
      if (days.isEmpty) return l10n.recurrenceWeekly;
      final labels = days.map((d) => weekdays[d.clamp(0, 6)]).join(', ');
      return l10n.recurrenceWeeklyWithDays(labels);
    case RecurrenceType.monthly:
      final parts = <String>[];
      final days = config.daysOfMonth ?? const <int>[];
      if (days.isNotEmpty) {
        parts.add(days.join(', '));
      }
      if (config.isLastDayOfMonth == true) {
        parts.add(l10n.recurrenceLastDay);
      }
      if (parts.isEmpty) return l10n.recurrenceMonthly;
      return l10n.recurrenceMonthlyWithParts(parts.join(', '));
    case RecurrenceType.everyXDays:
      final interval = config.intervalDays ?? 1;
      return interval == 1
          ? l10n.recurrenceEveryDay
          : l10n.recurrenceEveryNDays(interval);
  }
}

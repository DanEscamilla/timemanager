import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';

import '../models/activity.dart';

/// Parses `HH:mm` (optionally with seconds) into hour/minute parts.
({int hour, int minute}) parseTimeOfDay(String value) {
  final parts = value.split(':');
  if (parts.length < 2) {
    throw FormatException('Invalid time: $value');
  }
  final hour = int.parse(parts[0]);
  final minute = int.parse(parts[1]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw FormatException('Invalid time: $value');
  }
  return (hour: hour, minute: minute);
}

/// Combines a date-only [date] with an `HH:mm` time string.
DateTime combineDateAndTime(DateTime date, String time) {
  final parsed = parseTimeOfDay(time);
  return DateTime(date.year, date.month, date.day, parsed.hour, parsed.minute);
}

/// Maps expanded occurrences to [CalendarEventData] for calendar_view.
///
/// Uses the activity's group color when assigned; otherwise falls back to
/// [oneOffColor] / [recurringColor].
List<CalendarEventData<Activity>> toCalendarEvents(
  List<ActivityOccurrence> occurrences, {
  required Color oneOffColor,
  required Color recurringColor,
}) {
  return [
    for (final occurrence in occurrences)
      CalendarEventData<Activity>(
        title: occurrence.activity.title,
        description: occurrence.activity.description,
        date: occurrence.date,
        startTime: combineDateAndTime(
          occurrence.date,
          occurrence.activity.startTime,
        ),
        endTime: combineDateAndTime(
          occurrence.date,
          occurrence.activity.endTime,
        ),
        color: occurrence.activity.group?.colorValue ??
            (occurrence.activity.isRecurring ? recurringColor : oneOffColor),
        event: occurrence.activity,
      ),
  ];
}

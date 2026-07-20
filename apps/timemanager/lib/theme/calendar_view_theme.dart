import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';

/// Merges [calendar_view] theme extensions into a base design-system [ThemeData].
ThemeData withCalendarTheme(ThemeData base) {
  return base.copyWith(
    extensions: [
      ...base.extensions.values,
      ...buildCalendarViewThemeExtensions(base.colorScheme),
    ],
  );
}

/// Builds [calendar_view] theme extensions from the app [ColorScheme].
///
/// Without these, the package falls back to its own light/dark palettes
/// (unrelated to our Material theme) for weekday headers and month cells.
List<ThemeExtension<dynamic>> buildCalendarViewThemeExtensions(
  ColorScheme colorScheme,
) {
  return [
    DayViewThemeData(
      hourLineColor: colorScheme.outlineVariant,
      halfHourLineColor: colorScheme.outlineVariant,
      quarterHourLineColor: colorScheme.outlineVariant,
      pageBackgroundColor: colorScheme.surface,
      liveIndicatorColor: colorScheme.error,
      headerIconColor: colorScheme.onSurfaceVariant,
      headerTextColor: colorScheme.onSurface,
      headerBackgroundColor: colorScheme.surface,
      timelineTextColor: colorScheme.onSurfaceVariant,
    ),
    WeekViewThemeData(
      weekDayTileColor: colorScheme.surfaceContainerLow,
      weekDayTextColor: colorScheme.onSurfaceVariant,
      hourLineColor: colorScheme.outlineVariant,
      halfHourLineColor: colorScheme.outlineVariant,
      quarterHourLineColor: colorScheme.outlineVariant,
      liveIndicatorColor: colorScheme.error,
      pageBackgroundColor: colorScheme.surface,
      headerIconColor: colorScheme.onSurfaceVariant,
      headerTextColor: colorScheme.onSurface,
      headerBackgroundColor: colorScheme.surface,
      timelineTextColor: colorScheme.onSurfaceVariant,
      borderColor: colorScheme.outlineVariant,
      verticalLinesColor: colorScheme.outlineVariant,
    ),
    MonthViewThemeData(
      cellInMonthColor: colorScheme.surface,
      cellNotInMonthColor: colorScheme.surfaceContainerLow,
      cellTextColor: colorScheme.onSurface,
      cellBorderColor: colorScheme.outlineVariant,
      weekDayTileColor: colorScheme.surfaceContainerLow,
      weekDayTextColor: colorScheme.onSurfaceVariant,
      weekDayBorderColor: colorScheme.outlineVariant,
      headerIconColor: colorScheme.onSurfaceVariant,
      headerTextColor: colorScheme.onSurface,
      headerBackgroundColor: colorScheme.surface,
      cellHighlightColor: colorScheme.primary,
    ),
  ];
}

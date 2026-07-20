import 'package:calendar_view/calendar_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:timemanager/theme/app_theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  group('calendar_view theme extensions', () {
    test('light theme maps weekday and cell colors from ColorScheme', () {
      final theme = buildLightTheme();
      final scheme = theme.colorScheme;
      final week = theme.extension<WeekViewThemeData>();
      final month = theme.extension<MonthViewThemeData>();

      expect(week, isNotNull);
      expect(month, isNotNull);
      expect(week!.weekDayTileColor, scheme.surfaceContainerLow);
      expect(week.weekDayTextColor, scheme.onSurfaceVariant);
      expect(month!.weekDayTileColor, scheme.surfaceContainerLow);
      expect(month.cellInMonthColor, scheme.surface);
      expect(month.cellNotInMonthColor, scheme.surfaceContainerLow);
      expect(month.cellBorderColor, scheme.outlineVariant);
    });

    test('dark theme maps weekday and cell colors from ColorScheme', () {
      final theme = buildDarkTheme();
      final scheme = theme.colorScheme;
      final week = theme.extension<WeekViewThemeData>();
      final month = theme.extension<MonthViewThemeData>();

      expect(week, isNotNull);
      expect(month, isNotNull);
      expect(week!.weekDayTileColor, scheme.surfaceContainerLow);
      expect(month!.cellInMonthColor, scheme.surface);
      // Must not fall back to calendar_view's pink package defaults.
      expect(week.weekDayTileColor, isNot(const Color(0xfff6e4e4)));
      expect(month.weekDayTileColor, isNot(const Color(0xfff6e4e4)));
    });
  });
}

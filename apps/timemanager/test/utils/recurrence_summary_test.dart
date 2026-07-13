import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/l10n/app_localizations.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/utils/recurrence_summary.dart';

Activity _activity({
  required bool isRecurring,
  String? date,
  RecurrencePattern? recurrencePattern,
}) {
  final now = DateTime(2026, 7, 1);
  return Activity(
    id: 1,
    userId: 1,
    title: 'Focus',
    startTime: '09:00',
    endTime: '10:00',
    isRecurring: isRecurring,
    date: date,
    recurrencePattern: recurrencePattern,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  late AppLocalizations l10n;

  setUpAll(() async {
    l10n = await AppLocalizations.delegate.load(const Locale('en'));
  });

  test('formats one-time schedule without date', () {
    expect(
      formatActivitySchedule(_activity(isRecurring: false), l10n),
      '09:00 – 10:00',
    );
  });

  test('formats weekly recurrence summary', () {
    final pattern = RecurrencePattern(
      recurrenceType: RecurrenceType.weekly,
      config: const RecurrenceConfig(
        startDate: '2026-01-01',
        daysOfWeek: [1, 3],
      ),
    );
    expect(
      formatRecurrenceSummary(pattern, l10n),
      'Weekly · Mon, Wed',
    );
  });

  test('formats every-day recurrence', () {
    final pattern = RecurrencePattern(
      recurrenceType: RecurrenceType.everyXDays,
      config: const RecurrenceConfig(
        startDate: '2026-01-01',
        intervalDays: 1,
      ),
    );
    expect(formatRecurrenceSummary(pattern, l10n), 'Every day');
  });

  test('formats every-n-days recurrence', () {
    final pattern = RecurrencePattern(
      recurrenceType: RecurrenceType.everyXDays,
      config: const RecurrenceConfig(
        startDate: '2026-01-01',
        intervalDays: 3,
      ),
    );
    expect(formatRecurrenceSummary(pattern, l10n), 'Every 3 days');
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/activity.dart';
import 'package:timemanager/models/group.dart';
import 'package:timemanager/utils/calendar_event_mapper.dart';

Activity _activity({
  required int id,
  required String startTime,
  required String endTime,
  bool isRecurring = false,
  String? description,
  ActivityGroup? group,
}) {
  final now = DateTime(2026, 7, 1);
  return Activity(
    id: id,
    userId: 1,
    title: 'Activity $id',
    description: description,
    startTime: startTime,
    endTime: endTime,
    isRecurring: isRecurring,
    date: '2026-07-12',
    groupId: group?.id,
    group: group,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  group('parseTimeOfDay', () {
    test('parses HH:mm', () {
      final parsed = parseTimeOfDay('09:30');
      expect(parsed.hour, 9);
      expect(parsed.minute, 30);
    });

    test('parses HH:mm:ss by ignoring seconds', () {
      final parsed = parseTimeOfDay('14:05:00');
      expect(parsed.hour, 14);
      expect(parsed.minute, 5);
    });

    test('throws on invalid input', () {
      expect(() => parseTimeOfDay('not-a-time'), throwsFormatException);
      expect(() => parseTimeOfDay('25:00'), throwsFormatException);
    });
  });

  group('combineDateAndTime', () {
    test('attaches time onto the occurrence date', () {
      final combined = combineDateAndTime(DateTime(2026, 7, 12), '09:15');
      expect(combined, DateTime(2026, 7, 12, 9, 15));
    });
  });

  group('toCalendarEvents', () {
    test('maps occurrence fields and colors', () {
      final oneOff = _activity(id: 1, startTime: '09:00', endTime: '10:00');
      final recurring = _activity(
        id: 2,
        startTime: '11:00',
        endTime: '12:30',
        isRecurring: true,
        description: 'Gym',
      );

      final events = toCalendarEvents(
        [
          ActivityOccurrence(activity: oneOff, date: DateTime(2026, 7, 12)),
          ActivityOccurrence(activity: recurring, date: DateTime(2026, 7, 13)),
        ],
        oneOffColor: Colors.teal,
        recurringColor: Colors.orange,
      );

      expect(events, hasLength(2));

      expect(events[0].title, 'Activity 1');
      expect(events[0].date, DateTime(2026, 7, 12));
      expect(events[0].startTime, DateTime(2026, 7, 12, 9, 0));
      expect(events[0].endTime, DateTime(2026, 7, 12, 10, 0));
      expect(events[0].color, Colors.teal);
      expect(events[0].event?.id, 1);

      expect(events[1].description, 'Gym');
      expect(events[1].startTime, DateTime(2026, 7, 13, 11, 0));
      expect(events[1].endTime, DateTime(2026, 7, 13, 12, 30));
      expect(events[1].color, Colors.orange);
      expect(events[1].event?.id, 2);
    });

    test('uses group color when assigned', () {
      final now = DateTime(2026, 7, 1);
      final group = ActivityGroup(
        id: 10,
        userId: 1,
        name: 'Work',
        color: '#2563EB',
        createdAt: now,
        updatedAt: now,
      );
      final grouped = _activity(
        id: 3,
        startTime: '09:00',
        endTime: '10:00',
        group: group,
      );

      final events = toCalendarEvents(
        [ActivityOccurrence(activity: grouped, date: DateTime(2026, 7, 12))],
        oneOffColor: Colors.teal,
        recurringColor: Colors.orange,
      );

      expect(events, hasLength(1));
      expect(events[0].color, parseGroupColor('#2563EB'));
    });
  });
}

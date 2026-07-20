import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/utils/form_advanced_values.dart';
import 'package:design_system/design_system.dart';

void main() {
  group('rewardHasAdvancedValues', () {
    test('false for empty defaults and stackable', () {
      expect(
        rewardHasAdvancedValues(
          notes: '',
          category: '',
          tags: '',
          icon: '',
          stackable: true,
        ),
        isFalse,
      );
    });

    test('true when stackable is off', () {
      expect(
        rewardHasAdvancedValues(
          notes: '',
          category: '',
          tags: '',
          icon: '',
          stackable: false,
        ),
        isTrue,
      );
    });

    test('true when notes set', () {
      expect(
        rewardHasAdvancedValues(
          notes: 'memo',
          category: '',
          tags: '',
          icon: '',
          stackable: true,
        ),
        isTrue,
      );
    });
  });

  group('activityHasAdvancedValues', () {
    test('false for essentials-only', () {
      expect(
        activityHasAdvancedValues(
          description: '',
          groupId: null,
          recurrenceEndDate: null,
          isLastDayOfMonth: false,
          notificationOffsets: {},
        ),
        isFalse,
      );
    });

    test('true with notifications', () {
      expect(
        activityHasAdvancedValues(
          description: '',
          groupId: null,
          recurrenceEndDate: null,
          isLastDayOfMonth: false,
          notificationOffsets: {15},
        ),
        isTrue,
      );
    });

    test('true with group', () {
      expect(
        activityHasAdvancedValues(
          description: '',
          groupId: 1,
          recurrenceEndDate: null,
          isLastDayOfMonth: false,
          notificationOffsets: {},
        ),
        isTrue,
      );
    });
  });

  group('goalHasAdvancedValues', () {
    test('false for simple create defaults', () {
      expect(
        goalHasAdvancedValues(
          description: '',
          color: kGroupColorPalette.first,
          isComposite: false,
          dependencyIds: {},
          blockUntilUnlocked: false,
          useCustomStart: false,
          recurrencePeriod: null,
          deadlineKind: null,
        ),
        isFalse,
      );
    });

    test('ignores composite deps', () {
      expect(
        goalHasAdvancedValues(
          description: '',
          color: kGroupColorPalette.first,
          isComposite: true,
          dependencyIds: {1, 2},
          blockUntilUnlocked: false,
          useCustomStart: false,
          recurrencePeriod: null,
          deadlineKind: null,
        ),
        isFalse,
      );
    });

    test('true for non-composite deps', () {
      expect(
        goalHasAdvancedValues(
          description: '',
          color: kGroupColorPalette.first,
          isComposite: false,
          dependencyIds: {1},
          blockUntilUnlocked: false,
          useCustomStart: false,
          recurrencePeriod: null,
          deadlineKind: null,
        ),
        isTrue,
      );
    });

    test('true for deadline', () {
      expect(
        goalHasAdvancedValues(
          description: '',
          color: kGroupColorPalette.first,
          isComposite: false,
          dependencyIds: {},
          blockUntilUnlocked: false,
          useCustomStart: false,
          recurrencePeriod: null,
          deadlineKind: 'absolute',
        ),
        isTrue,
      );
    });
  });
}

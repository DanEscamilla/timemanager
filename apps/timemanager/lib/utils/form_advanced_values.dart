import 'package:design_system/design_system.dart';

/// Whether a reward definition has non-default Advanced-section values.
bool rewardHasAdvancedValues({
  required String notes,
  required String category,
  required String tags,
  required String icon,
  required bool stackable,
}) {
  return notes.trim().isNotEmpty ||
      category.trim().isNotEmpty ||
      tags.trim().isNotEmpty ||
      icon.trim().isNotEmpty ||
      !stackable;
}

/// Whether an activity form has non-default Advanced-section values.
bool activityHasAdvancedValues({
  required String description,
  required int? groupId,
  required DateTime? recurrenceEndDate,
  required bool isLastDayOfMonth,
  required Set<int> notificationOffsets,
}) {
  return description.trim().isNotEmpty ||
      groupId != null ||
      recurrenceEndDate != null ||
      isLastDayOfMonth ||
      notificationOffsets.isNotEmpty;
}

/// Whether a goal form has non-default Advanced-section values.
///
/// [dependencyIds] only count when [isComposite] is false (composite deps are
/// essential). [color] counts when it differs from the palette default.
bool goalHasAdvancedValues({
  required String description,
  required String color,
  required bool isComposite,
  required Set<int> dependencyIds,
  required bool blockUntilUnlocked,
  required bool useCustomStart,
  required String? recurrencePeriod,
  required String? deadlineKind,
}) {
  final nonDefaultColor =
      color.toUpperCase() != kGroupColorPalette.first.toUpperCase();
  final advancedDeps = !isComposite && dependencyIds.isNotEmpty;

  return description.trim().isNotEmpty ||
      nonDefaultColor ||
      advancedDeps ||
      blockUntilUnlocked ||
      useCustomStart ||
      recurrencePeriod != null ||
      deadlineKind != null;
}

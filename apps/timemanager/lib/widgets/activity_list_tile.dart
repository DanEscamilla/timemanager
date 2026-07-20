import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/activity.dart';
import '../utils/recurrence_summary.dart';

/// Activity row used in lists and Overview cards.
class ActivityListTile extends StatelessWidget {
  const ActivityListTile({
    super.key,
    required this.activity,
    this.scheduleOverride,
    this.onTap,
    this.onEdit,
    this.onDelete,
    this.showMenu = true,
    this.compact = false,
  });

  final Activity activity;
  final String? scheduleOverride;
  final VoidCallback? onTap;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final bool showMenu;
  final bool compact;

  Color _accentColor(ColorScheme colorScheme) {
    final group = activity.group;
    if (group != null) return group.colorValue;
    return activity.isRecurring ? colorScheme.tertiary : colorScheme.primary;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final type = activity.recurrencePattern?.recurrenceType;
    final schedule =
        scheduleOverride ?? formatActivitySchedule(activity, l10n);
    final accent = _accentColor(colorScheme);

    final tile = ListTile(
      contentPadding: compact
          ? EdgeInsets.zero
          : const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
      title: Text(activity.title, style: theme.textTheme.titleMedium),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            schedule,
            style: theme.textTheme.bodySmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
            ),
          ),
          if (!compact && activity.group != null)
            Text(
              activity.group!.name,
              style: theme.textTheme.bodySmall?.copyWith(
                color: accent,
              ),
            ),
          if (!compact && activity.description?.isNotEmpty == true)
            Text(
              activity.description!,
              style: theme.textTheme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
      isThreeLine: !compact &&
          (activity.description?.isNotEmpty == true || activity.group != null),
      leading: Container(
        width: 4,
        height: 40,
        decoration: BoxDecoration(
          color: accent,
          borderRadius: AppRadius.borderPill,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (activity.isRecurring)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.xs),
              child: Chip(
                label: Text(
                  type != null
                      ? recurrenceTypeLabel(type, l10n)
                      : l10n.activitiesRecurring,
                ),
                visualDensity: VisualDensity.compact,
              ),
            ),
          if (showMenu && (onEdit != null || onDelete != null))
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'edit') {
                  onEdit?.call();
                } else if (value == 'delete') {
                  onDelete?.call();
                }
              },
              itemBuilder: (context) {
                final menuL10n = AppLocalizations.of(context);
                return [
                  if (onEdit != null)
                    PopupMenuItem(
                      value: 'edit',
                      child: Text(menuL10n.activitiesEdit),
                    ),
                  if (onDelete != null)
                    PopupMenuItem(
                      value: 'delete',
                      child: Text(menuL10n.activitiesDelete),
                    ),
                ];
              },
            ),
        ],
      ),
      onTap: onTap,
    );

    if (compact) return tile;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.xs,
      ),
      child: AppCard(padding: EdgeInsets.zero, child: tile),
    );
  }
}

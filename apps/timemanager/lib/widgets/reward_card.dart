import 'package:flutter/material.dart';

import '../models/reward.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import 'app_card.dart';

/// Compact reward row for inventory / catalog lists.
class RewardCard extends StatelessWidget {
  const RewardCard({
    super.key,
    required this.name,
    required this.color,
    this.icon,
    this.quantity,
    this.subtitle,
    this.image,
    this.onTap,
  });

  factory RewardCard.fromInventory(
    RewardInventoryItem item, {
    Widget? image,
    VoidCallback? onTap,
  }) {
    return RewardCard(
      name: item.name,
      color: item.colorValue,
      icon: item.icon,
      quantity: item.quantity,
      subtitle: item.definition?.category,
      image: image,
      onTap: onTap,
    );
  }

  factory RewardCard.fromDefinition(
    RewardDefinition definition, {
    Widget? image,
    VoidCallback? onTap,
  }) {
    return RewardCard(
      name: definition.name,
      color: definition.colorValue,
      icon: definition.icon,
      subtitle: definition.category ?? definition.description,
      image: image,
      onTap: onTap,
    );
  }

  final String name;
  final Color color;
  final String? icon;
  final int? quantity;
  final String? subtitle;
  final Widget? image;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AppCard(
      onTap: onTap,
      child: Row(
        children: [
          _Leading(color: color, icon: icon, image: image),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: theme.textTheme.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null && subtitle!.trim().isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    subtitle!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (quantity != null) ...[
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: AppRadius.borderPill,
              ),
              child: Text(
                '×$quantity',
                style: theme.textTheme.labelLarge?.copyWith(color: color),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Leading extends StatelessWidget {
  const _Leading({
    required this.color,
    this.icon,
    this.image,
  });

  final Color color;
  final String? icon;
  final Widget? image;

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: SizedBox(
        width: 44,
        height: 44,
        child: image ??
            ColoredBox(
              color: color.withValues(alpha: 0.2),
              child: Center(
                child: icon != null && icon!.trim().isNotEmpty
                    ? Text(icon!, style: const TextStyle(fontSize: 20))
                    : Icon(Icons.card_giftcard, color: color),
              ),
            ),
      ),
    );
  }
}

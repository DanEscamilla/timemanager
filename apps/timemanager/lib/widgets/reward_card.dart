import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';

import '../models/reward.dart';

/// App wrappers that map reward models onto the shared [RewardCard] widget.
RewardCard rewardCardFromInventory(
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

RewardCard rewardCardFromDefinition(
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

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/reward.dart';
import '../services/graphql_client.dart';
import '../services/reward_repository.dart';
import '../theme/tokens/app_spacing.dart';
import 'app_card.dart';

/// Lists reward rules for an activity/goal and supports attach/detach.
class RewardRulesSection extends StatefulWidget {
  const RewardRulesSection({
    super.key,
    required this.repository,
    required this.sourceType,
    required this.sourceId,
  });

  final RewardRepository repository;
  final String sourceType;
  final int sourceId;

  @override
  State<RewardRulesSection> createState() => _RewardRulesSectionState();
}

class _RewardRulesSectionState extends State<RewardRulesSection> {
  late Future<List<RewardRule>> _rulesFuture;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void didUpdateWidget(covariant RewardRulesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sourceId != widget.sourceId ||
        oldWidget.sourceType != widget.sourceType) {
      _reload();
    }
  }

  void _reload() {
    setState(() {
      _rulesFuture = widget.repository.fetchRules(
        sourceType: widget.sourceType,
        sourceId: widget.sourceId,
      );
    });
  }

  Future<void> _attach() async {
    final l10n = AppLocalizations.of(context);
    List<RewardDefinition> definitions;
    try {
      definitions = await widget.repository.fetchDefinitions();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
      return;
    }

    if (!mounted) return;
    if (definitions.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.rewardsRulesNoDefinitions)),
      );
      return;
    }

    RewardDefinition selected = definitions.first;
    final qtyController = TextEditingController(text: '1');
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: Text(l10n.rewardsRulesAttachTitle),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<RewardDefinition>(
                    value: selected,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: l10n.rewardsRulesDefinition,
                    ),
                    items: [
                      for (final d in definitions)
                        DropdownMenuItem(
                          value: d,
                          child: Text(d.name),
                        ),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setDialogState(() => selected = v);
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextField(
                    controller: qtyController,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: l10n.rewardsRulesQuantity,
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: Text(l10n.activitiesCancel),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(l10n.rewardsRulesAttachAction),
                ),
              ],
            );
          },
        );
      },
    );

    if (confirmed != true) return;
    final qty = int.tryParse(qtyController.text.trim()) ?? 1;
    try {
      await widget.repository.attachRule(
        sourceType: widget.sourceType,
        sourceId: widget.sourceId,
        rewardDefinitionId: selected.id,
        quantity: qty < 1 ? 1 : qty,
      );
      _reload();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    }
  }

  Future<void> _detach(RewardRule rule) async {
    final l10n = AppLocalizations.of(context);
    try {
      await widget.repository.detachRule(rule.id);
      _reload();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.rewardsRulesSectionTitle,
                  style: theme.textTheme.titleSmall,
                ),
              ),
              TextButton.icon(
                onPressed: _attach,
                icon: const Icon(Icons.add, size: 18),
                label: Text(l10n.rewardsRulesAdd),
              ),
            ],
          ),
          FutureBuilder<List<RewardRule>>(
            future: _rulesFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  child: LinearProgressIndicator(),
                );
              }
              if (snapshot.hasError) {
                return Text(
                  snapshot.error is GraphQLException
                      ? (snapshot.error! as GraphQLException).localize(l10n)
                      : snapshot.error.toString(),
                  style: TextStyle(color: theme.colorScheme.error),
                );
              }
              final rules = snapshot.data ?? [];
              if (rules.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    l10n.rewardsRulesEmpty,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                );
              }
              return Column(
                children: [
                  for (final rule in rules)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(rule.definitionName),
                      subtitle: Text(l10n.rewardsRulesQtyLabel(rule.quantity)),
                      trailing: IconButton(
                        tooltip: l10n.rewardsRulesDetach,
                        onPressed: () => _detach(rule),
                        icon: const Icon(Icons.link_off),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

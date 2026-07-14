import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/reward.dart';
import '../services/asset_upload_service.dart';
import '../services/graphql_client.dart';
import '../services/reward_repository.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/app_card.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import '../widgets/reward_card.dart';

class RewardDetailScreen extends StatefulWidget {
  const RewardDetailScreen({
    super.key,
    required this.inventoryId,
    required this.rewardRepository,
    required this.assetUploadService,
    this.initialItem,
  });

  final int inventoryId;
  final RewardInventoryItem? initialItem;
  final RewardRepository rewardRepository;
  final AssetUploadService assetUploadService;

  @override
  State<RewardDetailScreen> createState() => _RewardDetailScreenState();
}

class _RewardDetailScreenState extends State<RewardDetailScreen> {
  late Future<_DetailData> _future;
  bool _changed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<_DetailData> _load() async {
    final inventory = await widget.rewardRepository.fetchInventory();
    final item = inventory.cast<RewardInventoryItem?>().firstWhere(
          (i) => i?.id == widget.inventoryId,
          orElse: () => widget.initialItem,
        );
    if (item == null) {
      throw StateError('inventory not found');
    }
    final history = await widget.rewardRepository.fetchHistory(
      definitionId: item.rewardDefinitionId,
      limit: 10,
    );
    return _DetailData(item: item, history: history);
  }

  void reload() {
    setState(() {
      _future = _load();
    });
  }

  Future<void> _consume(RewardInventoryItem item) async {
    final l10n = AppLocalizations.of(context);
    final qtyController = TextEditingController(text: '1');
    final noteController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.rewardsConsumeTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: qtyController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: l10n.rewardsConsumeQuantity,
              ),
              autofocus: true,
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: noteController,
              decoration: InputDecoration(
                labelText: l10n.rewardsConsumeNote,
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
            child: Text(l10n.rewardsConsumeAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final qty = int.tryParse(qtyController.text.trim()) ?? 1;
    final note = noteController.text.trim();
    setState(() => _busy = true);
    try {
      await widget.rewardRepository.consumeReward(
        inventoryId: item.id,
        quantity: qty < 1 ? 1 : qty,
        note: note.isEmpty ? null : note,
      );
      _changed = true;
      reload();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard(RewardInventoryItem item) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.rewardsDiscardTitle),
        content: Text(l10n.rewardsDiscardConfirm(item.name)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.activitiesCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.rewardsDiscardAction),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await widget.rewardRepository.discardReward(
        inventoryId: item.id,
        quantity: item.quantity,
      );
      _changed = true;
      if (mounted) Navigator.of(context).pop(true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    if (error is StateError) return l10n.rewardsNotFound;
    return error?.toString() ?? l10n.errorUnknown;
  }

  String _typeLabel(RewardTransactionType type, AppLocalizations l10n) {
    return switch (type) {
      RewardTransactionType.earn => l10n.rewardsTxEarn,
      RewardTransactionType.consume => l10n.rewardsTxConsume,
      RewardTransactionType.delete => l10n.rewardsTxDiscard,
      RewardTransactionType.restore => l10n.rewardsTxRestore,
      RewardTransactionType.adjust => l10n.rewardsTxAdjust,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        Navigator.of(context).pop(_changed);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.rewardsDetailTitle),
        ),
        body: FutureBuilder<_DetailData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting &&
                widget.initialItem == null) {
              return const LoadingView();
            }
            if (snapshot.hasError && snapshot.data == null) {
              return ErrorState(
                message: _errorMessage(snapshot.error, l10n),
                onRetry: reload,
              );
            }

            final data = snapshot.data;
            final item = data?.item ?? widget.initialItem;
            if (item == null) {
              return ErrorState(
                message: l10n.rewardsNotFound,
                onRetry: reload,
              );
            }
            final history = data?.history ?? const <RewardTransaction>[];

            return ListView(
              padding: const EdgeInsets.all(AppSpacing.screen),
              children: [
                RewardCard.fromInventory(item),
                if (item.definition?.description != null &&
                    item.definition!.description!.trim().isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Text(item.definition!.description!),
                  ),
                ],
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy ? null : () => _consume(item),
                        icon: const Icon(Icons.check),
                        label: Text(l10n.rewardsConsumeAction),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _discard(item),
                        icon: const Icon(Icons.delete_outline),
                        label: Text(l10n.rewardsDiscardAction),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  l10n.rewardsDetailHistory,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: AppSpacing.sm),
                if (history.isEmpty)
                  Text(
                    l10n.rewardsEmptyHistoryHint,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  ...history.map(
                    (tx) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(tx.definitionName),
                      subtitle: Text(
                        '${_typeLabel(tx.type, l10n)} · ×${tx.quantity}',
                      ),
                      trailing: Text(
                        '${tx.createdAt.toLocal().month}/${tx.createdAt.toLocal().day}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DetailData {
  const _DetailData({required this.item, required this.history});

  final RewardInventoryItem item;
  final List<RewardTransaction> history;
}

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/reward.dart';
import '../services/asset_upload_service.dart';
import '../services/graphql_client.dart';
import '../services/reward_repository.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import '../widgets/reward_card.dart';
import 'reward_detail_screen.dart';
import 'reward_form_screen.dart';

enum _RewardsSegment { inventory, catalog, history }

/// Rewards tab: Inventory | Catalog | History.
class RewardsScreen extends StatefulWidget {
  const RewardsScreen({
    super.key,
    required this.rewardRepository,
    required this.assetUploadService,
    this.onChanged,
  });

  final RewardRepository rewardRepository;
  final AssetUploadService assetUploadService;
  final VoidCallback? onChanged;

  @override
  State<RewardsScreen> createState() => RewardsScreenState();
}

class RewardsScreenState extends State<RewardsScreen> {
  _RewardsSegment _segment = _RewardsSegment.inventory;
  late Future<_RewardsData> _dataFuture;
  String _search = '';

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<_RewardsData> _load() async {
    final inventory = await widget.rewardRepository.fetchInventory();
    final definitions = await widget.rewardRepository.fetchDefinitions(
      includeArchived: true,
    );
    final history = await widget.rewardRepository.fetchHistory(limit: 50);
    return _RewardsData(
      inventory: inventory,
      definitions: definitions,
      history: history,
    );
  }

  void reload() {
    setState(() {
      _dataFuture = _load();
    });
  }

  List<RewardInventoryItem> _filterInventory(List<RewardInventoryItem> items) {
    final q = _search.toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where((i) => i.name.toLowerCase().contains(q))
        .toList();
  }

  List<RewardDefinition> _filterDefinitions(List<RewardDefinition> items) {
    final q = _search.toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where(
          (d) =>
              d.name.toLowerCase().contains(q) ||
              (d.category?.toLowerCase().contains(q) ?? false),
        )
        .toList();
  }

  List<RewardTransaction> _filterHistory(List<RewardTransaction> items) {
    final q = _search.toLowerCase();
    if (q.isEmpty) return items;
    return items
        .where((t) => t.definitionName.toLowerCase().contains(q))
        .toList();
  }

  Future<void> openCreateForm() async {
    setState(() => _segment = _RewardsSegment.catalog);
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RewardFormScreen(
          rewardRepository: widget.rewardRepository,
          assetUploadService: widget.assetUploadService,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _openEditDefinition(RewardDefinition definition) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RewardFormScreen(
          rewardRepository: widget.rewardRepository,
          assetUploadService: widget.assetUploadService,
          definition: definition,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _openInventoryDetail(RewardInventoryItem item) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RewardDetailScreen(
          inventoryId: item.id,
          initialItem: item,
          rewardRepository: widget.rewardRepository,
          assetUploadService: widget.assetUploadService,
        ),
      ),
    );
    if (changed == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.md,
            AppSpacing.xs,
          ),
          child: SegmentedButton<_RewardsSegment>(
            segments: [
              ButtonSegment(
                value: _RewardsSegment.inventory,
                label: Text(l10n.rewardsSegmentInventory),
              ),
              ButtonSegment(
                value: _RewardsSegment.catalog,
                label: Text(l10n.rewardsSegmentCatalog),
              ),
              ButtonSegment(
                value: _RewardsSegment.history,
                label: Text(l10n.rewardsSegmentHistory),
              ),
            ],
            selected: {_segment},
            onSelectionChanged: (s) => setState(() => _segment = s.single),
          ),
        ),
        if (_segment != _RewardsSegment.history)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              0,
              AppSpacing.md,
              AppSpacing.xs,
            ),
            child: TextField(
              decoration: InputDecoration(
                hintText: l10n.rewardsSearchHint,
                prefixIcon: const Icon(Icons.search),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() => _search = value.trim()),
            ),
          ),
        Expanded(
          child: FutureBuilder<_RewardsData>(
            future: _dataFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const LoadingView();
              }
              if (snapshot.hasError) {
                return ErrorState(
                  message: _errorMessage(snapshot.error, l10n),
                  onRetry: reload,
                );
              }

              final data = snapshot.data!;
              return RefreshIndicator(
                onRefresh: () async {
                  reload();
                  await _dataFuture;
                },
                child: switch (_segment) {
                  _RewardsSegment.inventory => _InventoryList(
                      items: _filterInventory(data.inventory),
                      onOpen: _openInventoryDetail,
                      onCreate: openCreateForm,
                    ),
                  _RewardsSegment.catalog => _CatalogList(
                      definitions: _filterDefinitions(data.definitions),
                      onOpen: _openEditDefinition,
                      onCreate: openCreateForm,
                    ),
                  _RewardsSegment.history => _HistoryList(
                      transactions: _filterHistory(data.history),
                    ),
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RewardsData {
  const _RewardsData({
    required this.inventory,
    required this.definitions,
    required this.history,
  });

  final List<RewardInventoryItem> inventory;
  final List<RewardDefinition> definitions;
  final List<RewardTransaction> history;
}

class _InventoryList extends StatelessWidget {
  const _InventoryList({
    required this.items,
    required this.onOpen,
    required this.onCreate,
  });

  final List<RewardInventoryItem> items;
  final ValueChanged<RewardInventoryItem> onOpen;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.5,
            child: EmptyState(
              icon: Icons.card_giftcard_outlined,
              title: l10n.rewardsEmptyInventoryTitle,
              message: l10n.rewardsEmptyInventoryHint,
              actionLabel: l10n.rewardsEmptyCatalogAction,
              onAction: onCreate,
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.screen),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        final item = items[index];
        return RewardCard.fromInventory(
          item,
          onTap: () => onOpen(item),
        );
      },
    );
  }
}

class _CatalogList extends StatelessWidget {
  const _CatalogList({
    required this.definitions,
    required this.onOpen,
    required this.onCreate,
  });

  final List<RewardDefinition> definitions;
  final ValueChanged<RewardDefinition> onOpen;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final active = definitions.where((d) => !d.isArchived).toList();
    if (active.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.5,
            child: EmptyState(
              icon: Icons.auto_awesome_outlined,
              title: l10n.rewardsEmptyCatalogTitle,
              message: l10n.rewardsEmptyCatalogHint,
              actionLabel: l10n.rewardsEmptyCatalogAction,
              onAction: onCreate,
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.screen),
      itemCount: active.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        final def = active[index];
        return RewardCard.fromDefinition(
          def,
          onTap: () => onOpen(def),
        );
      },
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.transactions});

  final List<RewardTransaction> transactions;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    if (transactions.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.5,
            child: EmptyState(
              icon: Icons.history,
              title: l10n.rewardsEmptyHistoryTitle,
              message: l10n.rewardsEmptyHistoryHint,
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.screen),
      itemCount: transactions.length,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        final tx = transactions[index];
        return ListTile(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          tileColor: theme.colorScheme.surfaceContainerHighest.withValues(
            alpha: 0.35,
          ),
          leading: CircleAvatar(
            backgroundColor: tx.colorValue.withValues(alpha: 0.2),
            child: Icon(
              _iconForType(tx.type),
              color: tx.colorValue,
              size: 20,
            ),
          ),
          title: Text(tx.definitionName),
          subtitle: Text(
            '${_typeLabel(tx.type, l10n)} · ×${tx.quantity}',
          ),
          trailing: Text(
            _shortDate(tx.createdAt),
            style: theme.textTheme.bodySmall,
          ),
        );
      },
    );
  }

  IconData _iconForType(RewardTransactionType type) {
    return switch (type) {
      RewardTransactionType.earn => Icons.add_circle_outline,
      RewardTransactionType.consume => Icons.check_circle_outline,
      RewardTransactionType.delete => Icons.delete_outline,
      RewardTransactionType.restore => Icons.undo,
      RewardTransactionType.adjust => Icons.tune,
    };
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

  String _shortDate(DateTime dt) {
    final local = dt.toLocal();
    return '${local.month}/${local.day}';
  }
}

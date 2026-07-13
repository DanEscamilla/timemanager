import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/group.dart';
import '../services/graphql_client.dart';
import '../services/group_repository.dart';
import '../theme/tokens/app_radius.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/app_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_state.dart';
import '../widgets/loading_view.dart';
import 'group_form_screen.dart';

class GroupsScreen extends StatefulWidget {
  const GroupsScreen({
    super.key,
    required this.repository,
    this.onChanged,
  });

  final GroupRepository repository;

  /// Called after a successful create/update/delete so activity views can refresh.
  final VoidCallback? onChanged;

  @override
  State<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends State<GroupsScreen> {
  late Future<List<ActivityGroup>> _groupsFuture;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _groupsFuture = widget.repository.fetchGroups();
    });
  }

  Future<void> _openForm({ActivityGroup? group}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => GroupFormScreen(
          repository: widget.repository,
          group: group,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _confirmDelete(ActivityGroup group) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.groupsDeleteTitle),
          content: Text(dialogL10n.groupsDeleteConfirm(group.name)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.activitiesCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.activitiesDelete),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.repository.deleteGroup(group.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.groupsDeleted)),
      );
      reload();
      widget.onChanged?.call();
    } on GraphQLException catch (e) {
      if (!mounted) return;
      final errorL10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(errorL10n))),
      );
    }
  }

  String _errorMessage(Object? error, AppLocalizations l10n) {
    if (error is GraphQLException) return error.localize(l10n);
    return error?.toString() ?? l10n.errorUnknown;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.groupsTitle),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openForm(),
        tooltip: l10n.tooltipAddGroup,
        child: const Icon(Icons.add),
      ),
      body: FutureBuilder<List<ActivityGroup>>(
        future: _groupsFuture,
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

          final groups = snapshot.data ?? [];
          if (groups.isEmpty) {
            return EmptyState(
              icon: Icons.folder_outlined,
              title: l10n.groupsEmptyTitle,
              message: l10n.groupsEmptyHint,
              actionLabel: l10n.groupsEmptyAction,
              onAction: () => _openForm(),
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              setState(() {
                _groupsFuture = widget.repository.fetchGroups();
              });
              await _groupsFuture;
            },
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
              itemCount: groups.length,
              itemBuilder: (context, index) {
                final group = groups[index];
                return Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.xs,
                  ),
                  child: AppCard(
                    padding: EdgeInsets.zero,
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.sm,
                      ),
                      leading: Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: group.colorValue,
                          borderRadius: AppRadius.borderPill,
                        ),
                      ),
                      title: Text(group.name),
                      onTap: () => _openForm(group: group),
                      trailing: PopupMenuButton<String>(
                        onSelected: (value) {
                          if (value == 'edit') {
                            _openForm(group: group);
                          } else if (value == 'delete') {
                            _confirmDelete(group);
                          }
                        },
                        itemBuilder: (context) {
                          final menuL10n = AppLocalizations.of(context);
                          return [
                            PopupMenuItem(
                              value: 'edit',
                              child: Text(menuL10n.activitiesEdit),
                            ),
                            PopupMenuItem(
                              value: 'delete',
                              child: Text(menuL10n.activitiesDelete),
                            ),
                          ];
                        },
                      ),
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

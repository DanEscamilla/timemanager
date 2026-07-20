import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/category.dart';
import '../services/category_repository.dart';
import '../services/graphql_client.dart';
import 'category_form_screen.dart';

class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({
    super.key,
    required this.repository,
    this.onChanged,
  });

  final CategoryRepository repository;
  final VoidCallback? onChanged;

  @override
  State<CategoriesScreen> createState() => CategoriesScreenState();
}

class CategoriesScreenState extends State<CategoriesScreen> {
  late Future<List<Category>> _future;

  @override
  void initState() {
    super.initState();
    reload();
  }

  void reload() {
    setState(() {
      _future = widget.repository.fetchCategories();
    });
  }

  Future<void> openCreateForm() => _openForm();

  Future<void> _openForm({Category? category}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CategoryFormScreen(
          repository: widget.repository,
          category: category,
        ),
      ),
    );
    if (saved == true) {
      reload();
      widget.onChanged?.call();
    }
  }

  Future<void> _confirmArchive(Category category) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.categoriesArchiveTitle),
          content: Text(dialogL10n.categoriesArchiveConfirm(category.name)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.archive),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.repository.archiveCategory(category.id);
      reload();
      widget.onChanged?.call();
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

    return FutureBuilder<List<Category>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l10n.errorCouldNotLoad),
                const SizedBox(height: AppSpacing.md),
                FilledButton(
                  onPressed: reload,
                  child: Text(l10n.errorRetry),
                ),
              ],
            ),
          );
        }

        final categories = snapshot.data ?? [];
        if (categories.isEmpty) {
          return EmptyState(
            icon: Icons.category_outlined,
            title: l10n.categoriesEmptyTitle,
            message: l10n.categoriesEmptyHint,
            actionLabel: l10n.categoriesEmptyAction,
            onAction: openCreateForm,
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.screen),
          itemCount: categories.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final category = categories[index];
            return AppCard(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: category.colorValue,
                  child: const Icon(Icons.label, color: Colors.white, size: 18),
                ),
                title: Text(category.name),
                trailing: PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'edit') {
                      _openForm(category: category);
                    } else if (value == 'archive') {
                      _confirmArchive(category);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(value: 'edit', child: Text(l10n.categoriesFormEdit)),
                    PopupMenuItem(value: 'archive', child: Text(l10n.archive)),
                  ],
                ),
                onTap: () => _openForm(category: category),
              ),
            );
          },
        );
      },
    );
  }
}

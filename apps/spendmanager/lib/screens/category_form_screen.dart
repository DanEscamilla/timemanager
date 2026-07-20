import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/category.dart';
import '../services/category_repository.dart';
import '../services/graphql_client.dart';

class CategoryFormScreen extends StatefulWidget {
  const CategoryFormScreen({
    super.key,
    required this.repository,
    this.category,
  });

  final CategoryRepository repository;
  final Category? category;

  bool get isEditing => category != null;

  @override
  State<CategoryFormScreen> createState() => _CategoryFormScreenState();
}

class _CategoryFormScreenState extends State<CategoryFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late String _color;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.category?.name ?? '');
    _color = widget.category?.color ?? kGroupColorPalette.first;
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);
    try {
      final name = _nameController.text.trim();
      if (widget.isEditing) {
        await widget.repository.updateCategory(
          id: widget.category!.id,
          name: name,
          color: _color,
        );
      } else {
        await widget.repository.createCategory(name: name, color: _color);
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.isEditing ? l10n.categoriesFormEdit : l10n.categoriesFormNew,
        ),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.screen),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _nameController,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      labelText: l10n.categoriesFormName,
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return l10n.categoriesFormNameRequired;
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    l10n.categoriesFormColor,
                    style: theme.textTheme.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final hex in kGroupColorPalette)
                        ColorSwatchButton(
                          color: parseCategoryColor(hex),
                          selected: _color.toUpperCase() == hex.toUpperCase(),
                          onTap: () => setState(() => _color = hex),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.save),
            ),
          ],
        ),
      ),
    );
  }
}

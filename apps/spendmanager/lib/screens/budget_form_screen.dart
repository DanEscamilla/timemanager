import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/budget.dart';
import '../models/category.dart';
import '../services/budget_repository.dart';
import '../services/category_repository.dart';
import '../services/graphql_client.dart';
import '../utils/money.dart';

class BudgetFormScreen extends StatefulWidget {
  const BudgetFormScreen({
    super.key,
    required this.budgetRepository,
    required this.categoryRepository,
    this.budget,
  });

  final BudgetRepository budgetRepository;
  final CategoryRepository categoryRepository;
  final Budget? budget;

  bool get isEditing => budget != null;

  @override
  State<BudgetFormScreen> createState() => _BudgetFormScreenState();
}

class _BudgetFormScreenState extends State<BudgetFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _amountController;
  late final TextEditingController _intervalCountController;
  late final TextEditingController _alertPercentController;

  bool _isTotal = true;
  int? _categoryId;
  String _intervalUnit = 'month';
  late DateTime _anchorDate;
  bool _saving = false;
  late Future<List<Category>> _categoriesFuture;

  @override
  void initState() {
    super.initState();
    final budget = widget.budget;
    _nameController = TextEditingController(text: budget?.name ?? '');
    _amountController = TextEditingController(
      text: budget != null ? centsToInput(budget.amountCents) : '',
    );
    _intervalCountController = TextEditingController(
      text: '${budget?.intervalCount ?? 1}',
    );
    _alertPercentController = TextEditingController(
      text: '${budget?.alertPercent ?? 80}',
    );
    _isTotal = budget?.isTotal ?? true;
    _categoryId = budget?.categoryId;
    _intervalUnit = budget?.intervalUnit ?? 'month';
    _anchorDate = budget?.anchorDate ?? DateTime.now();
    _categoriesFuture = widget.categoryRepository.fetchCategories();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _amountController.dispose();
    _intervalCountController.dispose();
    _alertPercentController.dispose();
    super.dispose();
  }

  Future<void> _pickAnchorDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _anchorDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) {
      setState(() => _anchorDate = picked);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_isTotal && _categoryId == null) {
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.budgetsFormCategoryRequired)),
      );
      return;
    }

    final amountCents = parseAmountToCents(_amountController.text);
    final intervalCount = int.tryParse(_intervalCountController.text.trim());
    final alertPercent = int.tryParse(_alertPercentController.text.trim());
    if (amountCents == null || intervalCount == null || alertPercent == null) {
      return;
    }

    setState(() => _saving = true);
    try {
      final name = _nameController.text.trim();
      final categoryId = _isTotal ? null : _categoryId;
      if (widget.isEditing) {
        await widget.budgetRepository.updateBudget(
          id: widget.budget!.id,
          name: name,
          amountCents: amountCents,
          intervalUnit: _intervalUnit,
          intervalCount: intervalCount,
          anchorDate: dateOnly(_anchorDate),
          alertPercent: alertPercent,
          categoryId: categoryId,
        );
      } else {
        await widget.budgetRepository.createBudget(
          name: name,
          amountCents: amountCents,
          intervalUnit: _intervalUnit,
          intervalCount: intervalCount,
          anchorDate: dateOnly(_anchorDate),
          alertPercent: alertPercent,
          categoryId: categoryId,
        );
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
          widget.isEditing ? l10n.budgetsFormEdit : l10n.budgetsFormNew,
        ),
      ),
      body: FutureBuilder<List<Category>>(
        future: _categoriesFuture,
        builder: (context, snapshot) {
          final categories = snapshot.data ?? const <Category>[];

          return Form(
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
                          labelText: l10n.budgetsFormName,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return l10n.budgetsFormNameRequired;
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        l10n.budgetsFormScope,
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      SegmentedButton<bool>(
                        segments: [
                          ButtonSegment(
                            value: true,
                            label: Text(l10n.budgetsScopeTotal),
                          ),
                          ButtonSegment(
                            value: false,
                            label: Text(l10n.budgetsScopeCategory),
                          ),
                        ],
                        selected: {_isTotal},
                        onSelectionChanged: (values) {
                          setState(() {
                            _isTotal = values.first;
                            if (_isTotal) _categoryId = null;
                          });
                        },
                      ),
                      if (!_isTotal) ...[
                        const SizedBox(height: AppSpacing.md),
                        DropdownButtonFormField<int>(
                          value: _categoryId,
                          decoration: InputDecoration(
                            labelText: l10n.budgetsFormCategory,
                          ),
                          items: [
                            for (final category in categories)
                              DropdownMenuItem(
                                value: category.id,
                                child: Text(category.name),
                              ),
                          ],
                          onChanged: (value) {
                            setState(() => _categoryId = value);
                          },
                          validator: (value) {
                            if (!_isTotal && value == null) {
                              return l10n.budgetsFormCategoryRequired;
                            }
                            return null;
                          },
                        ),
                      ],
                      const SizedBox(height: AppSpacing.lg),
                      TextFormField(
                        controller: _amountController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.budgetsFormAmount,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return l10n.budgetsFormAmountRequired;
                          }
                          if (parseAmountToCents(value) == null) {
                            return l10n.budgetsFormAmountInvalid;
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        l10n.budgetsFormInterval,
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: _intervalCountController,
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly,
                              ],
                              decoration: InputDecoration(
                                labelText: l10n.budgetsFormIntervalCount,
                              ),
                              validator: (value) {
                                final n = int.tryParse(value?.trim() ?? '');
                                if (n == null || n < 1) {
                                  return l10n.budgetsFormIntervalCountInvalid;
                                }
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: DropdownButtonFormField<String>(
                              value: _intervalUnit,
                              decoration: InputDecoration(
                                labelText: l10n.budgetsFormIntervalUnit,
                              ),
                              items: [
                                DropdownMenuItem(
                                  value: 'day',
                                  child: Text(l10n.budgetsIntervalUnitDay),
                                ),
                                DropdownMenuItem(
                                  value: 'week',
                                  child: Text(l10n.budgetsIntervalUnitWeek),
                                ),
                                DropdownMenuItem(
                                  value: 'month',
                                  child: Text(l10n.budgetsIntervalUnitMonth),
                                ),
                              ],
                              onChanged: (value) {
                                if (value != null) {
                                  setState(() => _intervalUnit = value);
                                }
                              },
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l10n.budgetsFormAnchorDate),
                        subtitle: Text(dateOnly(_anchorDate)),
                        trailing: const Icon(Icons.calendar_today_outlined),
                        onTap: _pickAnchorDate,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: _alertPercentController,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        decoration: InputDecoration(
                          labelText: l10n.budgetsFormAlertPercent,
                          suffixText: '%',
                        ),
                        validator: (value) {
                          final n = int.tryParse(value?.trim() ?? '');
                          if (n == null || n < 1 || n > 100) {
                            return l10n.budgetsFormAlertPercentInvalid;
                          }
                          return null;
                        },
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
          );
        },
      ),
    );
  }
}

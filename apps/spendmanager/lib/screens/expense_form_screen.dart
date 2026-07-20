import 'package:flutter/material.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/category.dart';
import '../models/expense.dart';
import '../services/category_repository.dart';
import '../services/expense_repository.dart';
import '../services/graphql_client.dart';
import '../utils/money.dart';

class ExpenseFormScreen extends StatefulWidget {
  const ExpenseFormScreen({
    super.key,
    required this.expenseRepository,
    required this.categoryRepository,
    this.expense,
  });

  final ExpenseRepository expenseRepository;
  final CategoryRepository categoryRepository;
  final Expense? expense;

  bool get isEditing => expense != null;

  @override
  State<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends State<ExpenseFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _amountController;
  late final TextEditingController _noteController;
  late DateTime _spentOn;
  int? _categoryId;
  List<Category> _categories = [];
  bool _loadingCategories = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final expense = widget.expense;
    _amountController = TextEditingController(
      text: expense != null ? centsToInput(expense.amountCents) : '',
    );
    _noteController = TextEditingController(text: expense?.note ?? '');
    _spentOn = expense?.spentOn ?? DateTime.now();
    _categoryId = expense?.categoryId;
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await widget.categoryRepository.fetchCategories();
      if (!mounted) return;
      setState(() {
        _categories = categories;
        _categoryId ??= categories.isNotEmpty ? categories.first.id : null;
        _loadingCategories = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingCategories = false);
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _spentOn,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) {
      setState(() => _spentOn = picked);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final l10n = AppLocalizations.of(context);
    if (_categoryId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.expensesFormCategoryRequired)),
      );
      return;
    }

    final cents = parseAmountToCents(_amountController.text);
    if (cents == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.expensesFormAmountInvalid)),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final note = _noteController.text.trim();
      if (widget.isEditing) {
        await widget.expenseRepository.updateExpense(
          id: widget.expense!.id,
          categoryId: _categoryId!,
          amountCents: cents,
          spentOn: dateOnly(_spentOn),
          note: note.isEmpty ? null : note,
        );
      } else {
        await widget.expenseRepository.createExpense(
          categoryId: _categoryId!,
          amountCents: cents,
          spentOn: dateOnly(_spentOn),
          note: note.isEmpty ? null : note,
        );
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
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

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.isEditing ? l10n.expensesFormEdit : l10n.expensesFormNew,
        ),
      ),
      body: _loadingCategories
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.screen),
                children: [
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextFormField(
                          controller: _amountController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: l10n.expensesFormAmount,
                            prefixText: '\$ ',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return l10n.expensesFormAmountRequired;
                            }
                            if (parseAmountToCents(value) == null) {
                              return l10n.expensesFormAmountInvalid;
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        DropdownButtonFormField<int>(
                          value: _categoryId,
                          decoration: InputDecoration(
                            labelText: l10n.expensesFormCategory,
                          ),
                          items: [
                            for (final c in _categories)
                              DropdownMenuItem(
                                value: c.id,
                                child: Text(c.name),
                              ),
                          ],
                          onChanged: (value) {
                            setState(() => _categoryId = value);
                          },
                          validator: (value) {
                            if (value == null) {
                              return l10n.expensesFormCategoryRequired;
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(l10n.expensesFormDate),
                          subtitle: Text(dateOnly(_spentOn)),
                          trailing: const Icon(Icons.calendar_today),
                          onTap: _pickDate,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        TextFormField(
                          controller: _noteController,
                          decoration: InputDecoration(
                            labelText: l10n.expensesFormNote,
                          ),
                          maxLines: 2,
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

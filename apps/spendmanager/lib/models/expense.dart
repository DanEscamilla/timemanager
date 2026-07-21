import '../utils/json_dates.dart';

class Expense {
  const Expense({
    required this.id,
    required this.userId,
    required this.categoryId,
    required this.amountCents,
    required this.currency,
    required this.spentOn,
    required this.createdAt,
    required this.updatedAt,
    this.note,
  });

  final int id;
  final int userId;
  final int categoryId;
  final int amountCents;
  final String currency;
  final DateTime spentOn;
  final String? note;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory Expense.fromJson(Map<String, dynamic> json) {
    return Expense(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      categoryId: _asInt(json['category_id']),
      amountCents: _asInt(json['amount_cents']),
      currency: json['currency'] as String,
      spentOn: DateTime.parse(json['spent_on'] as String),
      note: json['note'] as String?,
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }
}

class ExpenseTotal {
  const ExpenseTotal({
    required this.categoryId,
    required this.categoryName,
    required this.categoryColor,
    required this.currency,
    required this.totalCents,
  });

  final int categoryId;
  final String categoryName;
  final String categoryColor;
  final String currency;
  final int totalCents;

  factory ExpenseTotal.fromJson(Map<String, dynamic> json) {
    return ExpenseTotal(
      categoryId: Expense._asInt(json['category_id']),
      categoryName: json['category_name'] as String,
      categoryColor: json['category_color'] as String,
      currency: json['currency'] as String,
      totalCents: Expense._asInt(json['total_cents']),
    );
  }
}

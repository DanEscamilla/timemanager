class Budget {
  const Budget({
    required this.id,
    required this.userId,
    required this.name,
    required this.amountCents,
    required this.currency,
    required this.intervalUnit,
    required this.intervalCount,
    required this.anchorDate,
    required this.alertPercent,
    required this.createdAt,
    required this.updatedAt,
    this.categoryId,
    this.archivedAt,
  });

  final int id;
  final int userId;
  final String name;
  final int? categoryId;
  final int amountCents;
  final String currency;
  final String intervalUnit;
  final int intervalCount;
  final DateTime anchorDate;
  final int alertPercent;
  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isTotal => categoryId == null;
  bool get isArchived => archivedAt != null;

  factory Budget.fromJson(Map<String, dynamic> json) {
    return Budget(
      id: _asInt(json['id']),
      userId: _asInt(json['user_id']),
      name: json['name'] as String,
      categoryId: json['category_id'] == null
          ? null
          : _asInt(json['category_id']),
      amountCents: _asInt(json['amount_cents']),
      currency: json['currency'] as String,
      intervalUnit: json['interval_unit'] as String,
      intervalCount: _asInt(json['interval_count']),
      anchorDate: DateTime.parse(json['anchor_date'] as String),
      alertPercent: _asInt(json['alert_percent']),
      archivedAt: json['archived_at'] != null
          ? DateTime.parse(json['archived_at'] as String)
          : null,
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    return int.parse(value.toString());
  }

  static DateTime _parseDate(dynamic value) {
    if (value is String) return DateTime.parse(value);
    return DateTime.now();
  }
}

class BudgetStatus {
  const BudgetStatus({
    required this.budgetId,
    required this.budgetName,
    required this.currency,
    required this.amountCents,
    required this.spentCents,
    required this.percentUsed,
    required this.alertPercent,
    required this.alertTriggered,
    this.categoryId,
    this.periodStart,
    this.periodEndExclusive,
  });

  final int budgetId;
  final String budgetName;
  final int? categoryId;
  final String currency;
  final int amountCents;
  final int spentCents;
  final int percentUsed;
  final int alertPercent;
  final bool alertTriggered;
  final DateTime? periodStart;
  final DateTime? periodEndExclusive;

  factory BudgetStatus.fromJson(Map<String, dynamic> json) {
    return BudgetStatus(
      budgetId: Budget._asInt(json['budget_id']),
      budgetName: json['budget_name'] as String,
      categoryId: json['category_id'] == null
          ? null
          : Budget._asInt(json['category_id']),
      currency: json['currency'] as String,
      amountCents: Budget._asInt(json['amount_cents']),
      spentCents: Budget._asInt(json['spent_cents']),
      percentUsed: Budget._asInt(json['percent_used']),
      alertPercent: Budget._asInt(json['alert_percent']),
      alertTriggered: json['alert_triggered'] as bool,
      periodStart: json['period_start'] != null
          ? DateTime.parse(json['period_start'] as String)
          : null,
      periodEndExclusive: json['period_end_exclusive'] != null
          ? DateTime.parse(json['period_end_exclusive'] as String)
          : null,
    );
  }
}

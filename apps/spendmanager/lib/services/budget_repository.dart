import '../models/budget.dart';
import 'graphql_client.dart';

class BudgetRepository {
  BudgetRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _fields = '''
    id
    user_id
    name
    category_id
    amount_cents
    currency
    interval_unit
    interval_count
    anchor_date
    alert_percent
    archived_at
    created_at
    updated_at
  ''';

  Future<List<Budget>> fetchBudgets({bool includeArchived = false}) async {
    final data = await _client.query('''
      query FetchBudgets(\$includeArchived: Boolean) {
        budgets(args: { includeArchived: \$includeArchived }) {
          $_fields
        }
      }
    ''', variables: {
      'includeArchived': includeArchived,
    });

    final list = data['budgets'] as List<dynamic>? ?? [];
    return list
        .map((item) => Budget.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<BudgetStatus>> fetchStatuses({String? asOf}) async {
    final data = await _client.query('''
      query FetchBudgetStatuses(\$asOf: String) {
        budgetStatuses(args: { asOf: \$asOf }) {
          budget_id
          budget_name
          category_id
          currency
          amount_cents
          spent_cents
          percent_used
          alert_percent
          alert_triggered
          period_start
          period_end_exclusive
        }
      }
    ''', variables: {
      'asOf': asOf,
    });

    final list = data['budgetStatuses'] as List<dynamic>? ?? [];
    return list
        .map((item) => BudgetStatus.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Budget> createBudget({
    required String name,
    required int amountCents,
    required String intervalUnit,
    required int intervalCount,
    required String anchorDate,
    required int alertPercent,
    int? categoryId,
    String currency = 'USD',
  }) async {
    final data = await _client.mutate('''
      mutation CreateBudget(\$input: CreateBudgetInputInput!) {
        createBudget(args: { input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'input': {
        'name': name,
        'amountCents': amountCents,
        'intervalUnit': intervalUnit,
        'intervalCount': intervalCount,
        'anchorDate': anchorDate,
        'alertPercent': alertPercent,
        'categoryId': categoryId,
        'currency': currency,
      },
    });

    return Budget.fromJson(data['createBudget'] as Map<String, dynamic>);
  }

  Future<Budget> updateBudget({
    required int id,
    required String name,
    required int amountCents,
    required String intervalUnit,
    required int intervalCount,
    required String anchorDate,
    required int alertPercent,
    int? categoryId,
    String currency = 'USD',
  }) async {
    final data = await _client.mutate('''
      mutation UpdateBudget(\$id: Number!, \$input: UpdateBudgetInputInput!) {
        updateBudget(args: { id: \$id, input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        'name': name,
        'amountCents': amountCents,
        'intervalUnit': intervalUnit,
        'intervalCount': intervalCount,
        'anchorDate': anchorDate,
        'alertPercent': alertPercent,
        'categoryId': categoryId,
        'currency': currency,
      },
    });

    return Budget.fromJson(data['updateBudget'] as Map<String, dynamic>);
  }

  Future<Budget> archiveBudget(int id) async {
    final data = await _client.mutate('''
      mutation ArchiveBudget(\$id: Number!) {
        archiveBudget(args: { id: \$id }) {
          $_fields
        }
      }
    ''', variables: {
      'id': id,
    });

    return Budget.fromJson(data['archiveBudget'] as Map<String, dynamic>);
  }
}

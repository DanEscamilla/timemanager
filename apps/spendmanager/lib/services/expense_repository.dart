import '../models/expense.dart';
import 'graphql_client.dart';

class ExpenseRepository {
  ExpenseRepository({GraphQLClient? client})
      : _client = client ?? GraphQLClient();

  final GraphQLClient _client;

  static const _fields = '''
    id
    user_id
    category_id
    amount_cents
    currency
    spent_on
    note
    created_at
    updated_at
  ''';

  Future<List<Expense>> fetchExpenses({
    String? fromDate,
    String? toDate,
    int? categoryId,
  }) async {
    final data = await _client.query('''
      query FetchExpenses(
        \$fromDate: String
        \$toDate: String
        \$categoryId: Number
      ) {
        expenses(args: {
          fromDate: \$fromDate
          toDate: \$toDate
          categoryId: \$categoryId
        }) {
          $_fields
        }
      }
    ''', variables: {
      'fromDate': fromDate,
      'toDate': toDate,
      'categoryId': categoryId,
    });

    final list = data['expenses'] as List<dynamic>? ?? [];
    return list
        .map((item) => Expense.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<ExpenseTotal>> fetchTotals({
    required String fromDate,
    required String toDate,
  }) async {
    final data = await _client.query('''
      query FetchExpenseTotals(\$fromDate: String!, \$toDate: String!) {
        expenseTotals(args: { fromDate: \$fromDate, toDate: \$toDate }) {
          category_id
          category_name
          category_color
          currency
          total_cents
        }
      }
    ''', variables: {
      'fromDate': fromDate,
      'toDate': toDate,
    });

    final list = data['expenseTotals'] as List<dynamic>? ?? [];
    return list
        .map((item) => ExpenseTotal.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Expense> createExpense({
    required int categoryId,
    required int amountCents,
    required String spentOn,
    String currency = 'USD',
    String? note,
  }) async {
    final data = await _client.mutate('''
      mutation CreateExpense(\$input: CreateExpenseInputInput!) {
        createExpense(args: { input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'input': {
        'categoryId': categoryId,
        'amountCents': amountCents,
        'spentOn': spentOn,
        'currency': currency,
        'note': note,
      },
    });

    return Expense.fromJson(data['createExpense'] as Map<String, dynamic>);
  }

  Future<Expense> updateExpense({
    required int id,
    required int categoryId,
    required int amountCents,
    required String spentOn,
    String currency = 'USD',
    String? note,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateExpense(\$id: Number!, \$input: UpdateExpenseInputInput!) {
        updateExpense(args: { id: \$id, input: \$input }) {
          $_fields
        }
      }
    ''', variables: {
      'id': id,
      'input': {
        'categoryId': categoryId,
        'amountCents': amountCents,
        'spentOn': spentOn,
        'currency': currency,
        'note': note,
      },
    });

    return Expense.fromJson(data['updateExpense'] as Map<String, dynamic>);
  }

  Future<void> deleteExpense(int id) async {
    await _client.mutate('''
      mutation DeleteExpense(\$id: Number!) {
        deleteExpense(args: { id: \$id })
      }
    ''', variables: {
      'id': id,
    });
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spendmanager/config/api_config.dart';
import 'package:spendmanager/l10n/app_localizations.dart';
import 'package:spendmanager/models/category.dart';
import 'package:spendmanager/models/expense.dart';
import 'package:spendmanager/models/mailbox.dart';
import 'package:spendmanager/router/app_routes.dart';
import 'package:spendmanager/screens/expenses_screen.dart';
import 'package:spendmanager/services/category_repository.dart';
import 'package:spendmanager/services/expense_repository.dart';
import 'package:spendmanager/services/mailbox_repository.dart';
import 'package:spendmanager/widgets/expense_review_tab.dart';

MailboxAccount _mailbox({int id = 1}) {
  final now = DateTime.utc(2026, 7, 22);
  return MailboxAccount(
    id: id,
    userId: 1,
    provider: 'fixture',
    label: 'Demo',
    enabled: true,
    syncRequested: false,
    createdAt: now,
    updatedAt: now,
  );
}

ExtractionArtifact _pendingArtifact({int id = 1}) {
  final now = DateTime.utc(2026, 7, 22);
  return ExtractionArtifact(
    id: id,
    messageId: 10,
    kind: 'spending.candidate',
    payload: {
      'amountCents': 1299,
      'currency': 'USD',
      'spentOn': '2026-07-01',
      'merchant': 'Shop $id',
      'sourceSubject': 'Receipt $id',
      'templateId': 5,
    },
    confidence: 0.9,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  );
}

class _FakeExpenseRepository extends ExpenseRepository {
  @override
  Future<List<Expense>> fetchExpenses({
    String? fromDate,
    String? toDate,
    int? categoryId,
  }) async =>
      [];
}

class _FakeCategoryRepository extends CategoryRepository {
  @override
  Future<List<Category>> fetchCategories({bool includeArchived = false}) async =>
      [
        Category(
          id: 1,
          userId: 1,
          name: 'Food',
          color: '#FF0000',
          createdAt: DateTime.utc(2026, 7, 22),
          updatedAt: DateTime.utc(2026, 7, 22),
        ),
      ];
}

class _FakeMailboxRepository extends MailboxRepository {
  _FakeMailboxRepository({
    List<MailboxAccount>? mailboxes,
    List<DomainFilter>? filters,
    List<ExtractionArtifact>? pending,
  })  : _mailboxes = mailboxes ?? [],
        _filters = filters ?? [],
        pendingArtifacts = pending ?? [];

  final List<MailboxAccount> _mailboxes;
  final List<DomainFilter> _filters;
  final List<ExtractionArtifact> pendingArtifacts;
  final List<int> rejectAllIds = [];

  @override
  Future<List<MailboxAccount>> fetchMailboxes() async =>
      List<MailboxAccount>.from(_mailboxes);

  @override
  Future<List<DomainFilter>> fetchDomainFilters(int mailboxId) async =>
      List<DomainFilter>.from(_filters);

  @override
  Future<ExtractionArtifactPage> fetchArtifacts({
    int? mailboxId,
    String? status,
    int page = 1,
    int pageSize = 20,
  }) async =>
      ExtractionArtifactPage(
        items: List<ExtractionArtifact>.from(pendingArtifacts),
        totalCount: pendingArtifacts.length,
        page: page,
        pageSize: pageSize,
      );

  @override
  Future<int> rejectAllPendingArtifacts(int mailboxId) async {
    rejectAllIds.add(mailboxId);
    final count = pendingArtifacts.length;
    pendingArtifacts.clear();
    return count;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    ApiConfig.ensureConfigured();
  });

  testWidgets('Expenses shows History and Review tabs', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ExpensesScreen(
            expenseRepository: _FakeExpenseRepository(),
            categoryRepository: _FakeCategoryRepository(),
            mailboxRepository: _FakeMailboxRepository(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('History'), findsOneWidget);
    expect(find.text('Review'), findsOneWidget);
    expect(find.text('No expenses yet'), findsOneWidget);
  });

  testWidgets('Review tab shows setup CTA when no mailbox', (tester) async {
    var pushed = false;
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => Scaffold(
            body: ExpenseReviewTab(
              mailboxRepository: _FakeMailboxRepository(),
              categoryRepository: _FakeCategoryRepository(),
            ),
          ),
        ),
        GoRoute(
          path: AppRoutes.emailImport,
          builder: (context, state) {
            pushed = true;
            return const Scaffold(body: Text('setup'));
          },
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp.router(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Email import not set up'), findsOneWidget);
    await tester.tap(find.text('Set up email import'));
    await tester.pumpAndSettle();
    expect(pushed, isTrue);
  });

  testWidgets('Review rejects all pending artifacts', (tester) async {
    final mailboxRepo = _FakeMailboxRepository(
      mailboxes: [_mailbox()],
      filters: [
        DomainFilter(
          id: 1,
          mailboxId: 1,
          pattern: 'amazon.com',
          createdAt: DateTime.utc(2026, 7, 22),
        ),
      ],
      pending: [_pendingArtifact(id: 1), _pendingArtifact(id: 2)],
    );

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ExpenseReviewTab(
            mailboxRepository: mailboxRepo,
            categoryRepository: _FakeCategoryRepository(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Shop 1'), findsOneWidget);
    expect(find.byTooltip('Generate template with AI'), findsNothing);

    await tester.tap(find.text('Reject all'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Reject all'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.rejectAllIds, [1]);
    expect(find.text('Rejected 2 candidates.'), findsOneWidget);
  });
}

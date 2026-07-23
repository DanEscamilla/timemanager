import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spendmanager/config/api_config.dart';
import 'package:spendmanager/l10n/app_localizations.dart';
import 'package:spendmanager/models/category.dart';
import 'package:spendmanager/models/mailbox.dart';
import 'package:spendmanager/screens/email_import_screen.dart';
import 'package:spendmanager/services/category_repository.dart';
import 'package:spendmanager/services/mailbox_repository.dart';

MailboxAccount _mailbox({int id = 1, String label = 'Demo mailbox'}) {
  final now = DateTime.utc(2026, 7, 22);
  return MailboxAccount(
    id: id,
    userId: 1,
    provider: 'fixture',
    label: label,
    enabled: true,
    syncRequested: false,
    createdAt: now,
    updatedAt: now,
  );
}

class _FakeMailboxRepository extends MailboxRepository {
  _FakeMailboxRepository(this._mailboxes);

  List<MailboxAccount> _mailboxes;
  final List<int> deletedIds = [];
  final Map<int, String> updatedLabels = {};

  @override
  Future<List<MailboxAccount>> fetchMailboxes() async =>
      List<MailboxAccount>.from(_mailboxes);

  @override
  Future<bool> deleteMailbox(int id) async {
    deletedIds.add(id);
    _mailboxes = _mailboxes.where((m) => m.id != id).toList();
    return true;
  }

  @override
  Future<MailboxAccount> updateMailbox({
    required int id,
    required String label,
  }) async {
    updatedLabels[id] = label;
    _mailboxes = _mailboxes
        .map((m) {
          if (m.id != id) return m;
          return MailboxAccount(
            id: m.id,
            userId: m.userId,
            provider: m.provider,
            label: label,
            enabled: m.enabled,
            syncCursor: m.syncCursor,
            syncRequested: m.syncRequested,
            lastSyncedAt: m.lastSyncedAt,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          );
        })
        .toList();
    return _mailboxes.firstWhere((m) => m.id == id);
  }

  @override
  Future<List<DomainFilter>> fetchDomainFilters(int mailboxId) async => [];

  @override
  Future<List<MailboxMessage>> fetchMessages(int mailboxId) async => [];

  @override
  Future<List<ParsingTemplate>> fetchTemplates(int mailboxId) async => [];

  @override
  Future<List<ExtractionArtifact>> fetchArtifacts({
    int? mailboxId,
    String? status,
  }) async =>
      [];
}

class _FakeCategoryRepository extends CategoryRepository {
  @override
  Future<List<Category>> fetchCategories({bool includeArchived = false}) async =>
      [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    ApiConfig.ensureConfigured();
  });

  testWidgets('deletes selected mailbox after confirmation', (tester) async {
    final mailboxRepo = _FakeMailboxRepository([_mailbox()]);
    final categoryRepo = _FakeCategoryRepository();

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => EmailImportScreen(
            mailboxRepository: mailboxRepo,
            categoryRepository: categoryRepo,
          ),
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

    expect(find.text('Demo mailbox (fixture)'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete mailbox'));
    await tester.pumpAndSettle();

    expect(find.text('Delete mailbox?'), findsOneWidget);
    expect(
      find.text(
        'Remove "Demo mailbox"? Synced messages, filters, and templates '
        'for this mailbox will be deleted.',
      ),
      findsOneWidget,
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.deletedIds, [1]);
    expect(find.text('No mailbox yet. Add a demo mailbox or connect Gmail.'),
        findsOneWidget);
  });

  testWidgets('renames selected mailbox', (tester) async {
    final mailboxRepo = _FakeMailboxRepository([_mailbox()]);
    final categoryRepo = _FakeCategoryRepository();

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => EmailImportScreen(
            mailboxRepository: mailboxRepo,
            categoryRepository: categoryRepo,
          ),
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

    await tester.tap(find.byTooltip('Rename mailbox'));
    await tester.pumpAndSettle();

    expect(find.text('Rename mailbox'), findsWidgets);
    await tester.enterText(find.byType(TextField), 'Work inbox');
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.updatedLabels, {1: 'Work inbox'});
    expect(find.text('Work inbox (fixture)'), findsOneWidget);
  });
}

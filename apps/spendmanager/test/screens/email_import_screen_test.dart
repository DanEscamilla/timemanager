import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spendmanager/config/api_config.dart';
import 'package:spendmanager/l10n/app_localizations.dart';
import 'package:spendmanager/models/mailbox.dart';
import 'package:spendmanager/screens/email_import_screen.dart';
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
  _FakeMailboxRepository(
    this._mailboxes, {
    List<DomainFilter>? filters,
  }) : _filters = filters ?? [];

  List<MailboxAccount> _mailboxes;
  List<DomainFilter> _filters;
  final List<int> deletedIds = [];
  final List<int> clearedInboxIds = [];
  final Map<int, String> updatedLabels = {};
  List<String>? lastSetPatterns;

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
  Future<MailboxAccount> clearInbox(int mailboxId) async {
    clearedInboxIds.add(mailboxId);
    return _mailboxes.firstWhere((m) => m.id == mailboxId);
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
            syncSince: m.syncSince,
            syncUntil: m.syncUntil,
            lastSyncedAt: m.lastSyncedAt,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          );
        })
        .toList();
    return _mailboxes.firstWhere((m) => m.id == id);
  }

  @override
  Future<List<DomainFilter>> fetchDomainFilters(int mailboxId) async =>
      List<DomainFilter>.from(_filters);

  @override
  Future<List<DomainFilter>> setDomainFilters({
    required int mailboxId,
    required List<String> patterns,
  }) async {
    lastSetPatterns = patterns;
    final now = DateTime.utc(2026, 7, 22);
    _filters = [
      for (var i = 0; i < patterns.length; i++)
        DomainFilter(
          id: i + 1,
          mailboxId: mailboxId,
          pattern: patterns[i],
          createdAt: now,
        ),
    ];
    return _filters;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    ApiConfig.ensureConfigured();
  });

  testWidgets('deletes selected mailbox after confirmation', (tester) async {
    final mailboxRepo = _FakeMailboxRepository([_mailbox()]);

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => EmailImportScreen(
            mailboxRepository: mailboxRepo,
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
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.deletedIds, [1]);
    expect(
      find.text('No mailbox yet. Add a demo mailbox or connect Gmail.'),
      findsWidgets,
    );
  });

  testWidgets('renames selected mailbox', (tester) async {
    final mailboxRepo = _FakeMailboxRepository([_mailbox()]);

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => EmailImportScreen(
            mailboxRepository: mailboxRepo,
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
    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      'Work inbox',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.updatedLabels, {1: 'Work inbox'});
    expect(find.text('Work inbox (fixture)'), findsOneWidget);
  });

  testWidgets('wizard advances to senders and can clear inbox', (tester) async {
    final mailboxRepo = _FakeMailboxRepository(
      [_mailbox()],
      filters: [
        DomainFilter(
          id: 1,
          mailboxId: 1,
          pattern: 'amazon.com',
          createdAt: DateTime.utc(2026, 7, 22),
        ),
      ],
    );

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => EmailImportScreen(
            mailboxRepository: mailboxRepo,
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

    expect(find.text('Mailbox'), findsWidgets);
    await tester.tap(find.widgetWithText(FilledButton, 'Next'));
    await tester.pumpAndSettle();

    expect(find.text('Senders'), findsWidgets);
    expect(find.text('Sync now'), findsOneWidget);

    final clearBtn = find.text('Clear inbox data');
    await tester.ensureVisible(clearBtn);
    await tester.pumpAndSettle();
    await tester.tap(clearBtn);
    await tester.pumpAndSettle();
    expect(find.text('Clear inbox data?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Clear inbox data'));
    await tester.pumpAndSettle();

    expect(mailboxRepo.clearedInboxIds, [1]);
    expect(find.text('Inbox data cleared.'), findsOneWidget);
  });
}

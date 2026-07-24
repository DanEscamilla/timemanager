import 'package:flutter/material.dart';
import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:go_router/go_router.dart';

import '../l10n/app_localizations.dart';
import '../l10n/exception_localizations.dart';
import '../models/category.dart';
import '../models/mailbox.dart';
import '../router/app_routes.dart';
import '../services/category_repository.dart';
import '../services/mailbox_repository.dart';
import '../utils/money.dart';
import 'source_email_sheet.dart';

/// Pending email spending candidates for the Expenses Review tab.
class ExpenseReviewTab extends StatefulWidget {
  const ExpenseReviewTab({
    super.key,
    required this.mailboxRepository,
    required this.categoryRepository,
    this.onAccepted,
  });

  final MailboxRepository mailboxRepository;
  final CategoryRepository categoryRepository;
  final VoidCallback? onAccepted;

  @override
  State<ExpenseReviewTab> createState() => ExpenseReviewTabState();
}

class ExpenseReviewTabState extends State<ExpenseReviewTab> {
  static const int _pageSize = 20;

  bool _loading = true;
  String? _error;
  bool _setupRequired = false;
  List<MailboxAccount> _mailboxes = [];
  MailboxAccount? _selected;
  List<ExtractionArtifact> _pending = [];
  List<Category> _categories = [];
  int _page = 1;
  int _totalCount = 0;
  int _totalPages = 1;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final mailboxes = await widget.mailboxRepository.fetchMailboxes();
      final categories = await widget.categoryRepository.fetchCategories();

      if (mailboxes.isEmpty) {
        if (!mounted) return;
        setState(() {
          _mailboxes = [];
          _selected = null;
          _pending = [];
          _categories = categories;
          _setupRequired = true;
          _loading = false;
          _page = 1;
          _totalCount = 0;
          _totalPages = 1;
        });
        return;
      }

      MailboxAccount? selected = _selected;
      if (selected != null) {
        selected = mailboxes.cast<MailboxAccount?>().firstWhere(
              (m) => m?.id == selected!.id,
              orElse: () => mailboxes.first,
            );
      } else {
        selected = mailboxes.first;
      }

      final filters =
          await widget.mailboxRepository.fetchDomainFilters(selected!.id);
      if (filters.isEmpty) {
        if (!mounted) return;
        setState(() {
          _mailboxes = mailboxes;
          _selected = selected;
          _pending = [];
          _categories = categories;
          _setupRequired = true;
          _loading = false;
          _page = 1;
          _totalCount = 0;
          _totalPages = 1;
        });
        return;
      }

      var page = _page;
      var artifactPage = await widget.mailboxRepository.fetchArtifacts(
        mailboxId: selected.id,
        status: 'pending',
        page: page,
        pageSize: _pageSize,
      );
      if (artifactPage.items.isEmpty &&
          artifactPage.totalCount > 0 &&
          page > 1) {
        page = artifactPage.totalPages.clamp(1, artifactPage.totalPages);
        artifactPage = await widget.mailboxRepository.fetchArtifacts(
          mailboxId: selected.id,
          status: 'pending',
          page: page,
          pageSize: _pageSize,
        );
      }

      if (!mounted) return;
      setState(() {
        _mailboxes = mailboxes;
        _selected = selected;
        _pending = artifactPage.items;
        _categories = categories;
        _setupRequired = false;
        _loading = false;
        _page = artifactPage.page;
        _totalCount = artifactPage.totalCount;
        _totalPages = artifactPage.totalPages;
      });
    } catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      setState(() {
        _loading = false;
        _error = e is GraphQLException
            ? e.localize(l10n)
            : l10n.errorCouldNotLoad;
      });
    }
  }

  void _showError(Object e) {
    if (!mounted) return;
    final l10n = AppLocalizations.of(context);
    final message = e is String
        ? e
        : e is GraphQLException
            ? e.localize(l10n)
            : l10n.errorCouldNotLoad;
    if (message.length > 80) {
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          content: SingleChildScrollView(child: SelectableText(message)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(MaterialLocalizations.of(ctx).okButtonLabel),
            ),
          ],
        ),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _goToPage(int page) async {
    if (page < 1 || page > _totalPages || page == _page) return;
    setState(() => _page = page);
    await reload();
  }

  Future<void> _confirmRejectAll() async {
    final mailbox = _selected;
    if (mailbox == null || _totalCount < 1) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.emailImportRejectAllTitle),
          content: Text(
            dialogL10n.emailImportRejectAllConfirm(_totalCount),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.emailImportRejectAll),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    final l10n = AppLocalizations.of(context);
    try {
      final count = await widget.mailboxRepository
          .rejectAllPendingArtifacts(mailbox.id);
      _page = 1;
      await reload();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.emailImportRejectAllDone(count))),
      );
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _accept(ExtractionArtifact artifact) async {
    final l10n = AppLocalizations.of(context);
    if (_categories.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.emailImportNeedCategory)),
      );
      return;
    }
    var categoryId = _categories.first.id;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(l10n.emailImportAcceptTitle),
          content: DropdownButtonFormField<int>(
            value: categoryId,
            items: _categories
                .map(
                  (c) => DropdownMenuItem(
                    value: c.id,
                    child: Text(c.name),
                  ),
                )
                .toList(),
            onChanged: (v) {
              if (v == null) return;
              setDialogState(() => categoryId = v);
            },
            decoration: InputDecoration(labelText: l10n.emailImportCategory),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: Text(l10n.emailImportCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(l10n.emailImportAccept),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await widget.mailboxRepository.updateArtifactStatus(
        artifactId: artifact.id,
        status: 'accepted',
        categoryId: categoryId,
      );
      await reload();
      widget.onAccepted?.call();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _reject(ExtractionArtifact artifact) async {
    try {
      await widget.mailboxRepository.updateArtifactStatus(
        artifactId: artifact.id,
        status: 'rejected',
      );
      await reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _viewSourceEmail(ExtractionArtifact artifact) async {
    final l10n = AppLocalizations.of(context);
    try {
      final message =
          await widget.mailboxRepository.fetchMessage(artifact.messageId);
      if (!mounted) return;
      if (message == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.sourceEmailNotFound)),
        );
        return;
      }
      await showSourceEmailSheet(context, message: message);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.sourceEmailLoadFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (_loading) return const LoadingView();
    if (_error != null) {
      return ErrorState(
        message: _error!,
        onRetry: reload,
        title: l10n.errorCouldNotLoad,
        retryLabel: l10n.errorRetry,
      );
    }
    if (_setupRequired) {
      return EmptyState(
        icon: Icons.mail_outline,
        title: l10n.expensesReviewSetupRequiredTitle,
        message: l10n.expensesReviewSetupRequiredHint,
        actionLabel: l10n.expensesReviewSetupCta,
        onAction: () => context.push(AppRoutes.emailImport),
      );
    }

    if (_pending.isEmpty && _totalCount == 0) {
      return Column(
        children: [
          if (_mailboxes.length > 1) _buildMailboxPicker(l10n),
          Expanded(child: Center(child: Text(l10n.emailImportNoPending))),
        ],
      );
    }

    return Column(
      children: [
        if (_mailboxes.length > 1) _buildMailboxPicker(l10n),
        if (_totalCount > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screen,
              AppSpacing.sm,
              AppSpacing.screen,
              0,
            ),
            child: Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _confirmRejectAll,
                icon: const Icon(Icons.close),
                label: Text(l10n.emailImportRejectAll),
              ),
            ),
          ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.screen),
            itemCount: _pending.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final a = _pending[i];
              final amount = a.amountCents == null
                  ? '—'
                  : formatMoney(a.amountCents!, currency: a.currency);
              return ListTile(
                title: Text(a.merchant ?? 'Candidate #${a.id}'),
                subtitle: Text(
                  [
                    if (a.sourceSubject != null &&
                        a.sourceSubject!.trim().isNotEmpty)
                      a.sourceSubject!.trim(),
                    '$amount · ${a.spentOn ?? '—'} · '
                        '${(a.confidence * 100).round()}%',
                  ].join('\n'),
                ),
                isThreeLine: a.sourceSubject != null &&
                    a.sourceSubject!.trim().isNotEmpty,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: l10n.emailImportViewEmail,
                      icon: const Icon(Icons.mail_outline),
                      onPressed: () => _viewSourceEmail(a),
                    ),
                    IconButton(
                      tooltip: l10n.emailImportReject,
                      icon: const Icon(Icons.close),
                      onPressed: () => _reject(a),
                    ),
                    IconButton(
                      tooltip: l10n.emailImportAccept,
                      icon: const Icon(Icons.check),
                      onPressed: () => _accept(a),
                    ),
                  ],
                ),
                onTap: () => _viewSourceEmail(a),
              );
            },
          ),
        ),
        if (_totalPages > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screen,
              0,
              AppSpacing.screen,
              AppSpacing.screen,
            ),
            child: _buildPagination(l10n),
          ),
      ],
    );
  }

  Widget _buildMailboxPicker(AppLocalizations l10n) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.sm,
        AppSpacing.screen,
        0,
      ),
      child: DropdownButtonFormField<int>(
        value: _selected?.id,
        items: _mailboxes
            .map(
              (m) => DropdownMenuItem(
                value: m.id,
                child: Text('${m.label} (${m.provider})'),
              ),
            )
            .toList(),
        onChanged: (id) {
          setState(() {
            _selected = _mailboxes.firstWhere((m) => m.id == id);
            _page = 1;
          });
          reload();
        },
        decoration: InputDecoration(labelText: l10n.emailImportMailbox),
      ),
    );
  }

  Widget _buildPagination(AppLocalizations l10n) {
    final pages = _pageWindow(_page, _totalPages);
    return Column(
      children: [
        Text(l10n.emailImportPageOf(_page, _totalPages)),
        const SizedBox(height: AppSpacing.xs),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: AppSpacing.xs,
          runSpacing: AppSpacing.xs,
          children: [
            TextButton(
              onPressed: _page > 1 ? () => _goToPage(_page - 1) : null,
              child: Text(l10n.emailImportPagePrevious),
            ),
            for (final p in pages)
              p == _page
                  ? FilledButton(
                      onPressed: () => _goToPage(p),
                      child: Text('$p'),
                    )
                  : OutlinedButton(
                      onPressed: () => _goToPage(p),
                      child: Text('$p'),
                    ),
            TextButton(
              onPressed:
                  _page < _totalPages ? () => _goToPage(_page + 1) : null,
              child: Text(l10n.emailImportPageNext),
            ),
          ],
        ),
      ],
    );
  }

  List<int> _pageWindow(int current, int total) {
    if (total <= 5) {
      return [for (var i = 1; i <= total; i++) i];
    }
    var start = current - 2;
    var end = current + 2;
    if (start < 1) {
      end += 1 - start;
      start = 1;
    }
    if (end > total) {
      start -= end - total;
      end = total;
    }
    start = start.clamp(1, total);
    return [for (var i = start; i <= end; i++) i];
  }
}

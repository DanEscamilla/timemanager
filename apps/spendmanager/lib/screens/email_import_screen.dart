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
import '../services/gmail_oauth_launch.dart';
import '../services/mailbox_repository.dart';
import '../utils/money.dart';
import '../widgets/source_email_sheet.dart';

/// Per-user email import: mailbox setup, domain filters, templates, review queue.
class EmailImportScreen extends StatefulWidget {
  const EmailImportScreen({
    super.key,
    required this.mailboxRepository,
    required this.categoryRepository,
  });

  final MailboxRepository mailboxRepository;
  final CategoryRepository categoryRepository;

  @override
  State<EmailImportScreen> createState() => _EmailImportScreenState();
}

class _EmailImportScreenState extends State<EmailImportScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  bool _loading = true;
  String? _error;
  List<MailboxAccount> _mailboxes = [];
  MailboxAccount? _selected;
  List<DomainFilter> _filters = [];
  List<MailboxMessage> _messages = [];
  List<ParsingTemplate> _templates = [];
  List<ExtractionArtifact> _pending = [];
  List<Category> _categories = [];
  bool _generatingTemplate = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _reload();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _handleGmailOAuthReturn();
    });
  }

  void _handleGmailOAuthReturn() {
    if (!mounted) return;
    final params = GoRouterState.of(context).uri.queryParameters;
    final gmail = params['gmail'];
    if (gmail == null || gmail.isEmpty) return;

    final l10n = AppLocalizations.of(context);
    if (gmail == 'connected') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.emailImportGmailConnected)),
      );
    } else {
      final detail = params['error'];
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            detail != null && detail.isNotEmpty
                ? l10n.emailImportGmailFailed(detail)
                : l10n.emailImportGmailFailedGeneric,
          ),
        ),
      );
    }
    context.go(AppRoutes.emailImport);
    _reload();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final mailboxes = await widget.mailboxRepository.fetchMailboxes();
      final categories =
          await widget.categoryRepository.fetchCategories();
      MailboxAccount? selected = _selected;
      if (selected != null) {
        selected = mailboxes.cast<MailboxAccount?>().firstWhere(
              (m) => m?.id == selected!.id,
              orElse: () => mailboxes.isNotEmpty ? mailboxes.first : null,
            );
      } else if (mailboxes.isNotEmpty) {
        selected = mailboxes.first;
      }

      List<DomainFilter> filters = [];
      List<MailboxMessage> messages = [];
      List<ParsingTemplate> templates = [];
      List<ExtractionArtifact> pending = [];
      if (selected != null) {
        filters =
            await widget.mailboxRepository.fetchDomainFilters(selected.id);
        messages = await widget.mailboxRepository.fetchMessages(selected.id);
        templates =
            await widget.mailboxRepository.fetchTemplates(selected.id);
        pending = await widget.mailboxRepository.fetchArtifacts(
          mailboxId: selected.id,
          status: 'pending',
        );
      }

      if (!mounted) return;
      setState(() {
        _mailboxes = mailboxes;
        _selected = selected;
        _filters = filters;
        _messages = messages;
        _templates = templates;
        _pending = pending;
        _categories = categories;
        _loading = false;
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
    final message =
        e is GraphQLException ? e.localize(l10n) : l10n.errorCouldNotLoad;
    // Validation hints from mailbox-api are long; SnackBar truncates them.
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

  Future<void> _createFixture() async {
    final l10n = AppLocalizations.of(context);
    try {
      await widget.mailboxRepository.createMailbox(
        provider: 'fixture',
        label: l10n.emailImportFixtureLabel,
        domainFilters: const ['amazon.com', 'uber.com'],
      );
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _createGmail() async {
    final l10n = AppLocalizations.of(context);
    try {
      final mailbox = await widget.mailboxRepository.createMailbox(
        provider: 'gmail',
        label: l10n.emailImportGmailLabel,
      );
      final authorizationUrl =
          await widget.mailboxRepository.startGmailOAuth(
        mailboxId: mailbox.id,
        returnTo: GmailOAuthLaunch.emailImportReturnTo(),
      );
      final launched =
          await GmailOAuthLaunch.openAuthorizationUrl(authorizationUrl);
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.emailImportGmailLaunchFailed)),
        );
      }
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _confirmDeleteMailbox(MailboxAccount mailbox) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.emailImportDeleteMailboxTitle),
          content: Text(
            dialogL10n.emailImportDeleteMailboxConfirm(mailbox.label),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.delete),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    try {
      await widget.mailboxRepository.deleteMailbox(mailbox.id);
      if (_selected?.id == mailbox.id) {
        _selected = null;
      }
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _renameMailbox(MailboxAccount mailbox) async {
    final l10n = AppLocalizations.of(context);
    final ctrl = TextEditingController(text: mailbox.label);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.emailImportRenameMailboxTitle),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(
            labelText: l10n.emailImportMailboxName,
          ),
          onSubmitted: (_) => Navigator.pop(ctx, true),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.emailImportCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.emailImportSave),
          ),
        ],
      ),
    );
    final label = ctrl.text.trim();
    try {
      if (ok != true || !mounted || label.isEmpty || label == mailbox.label) {
        return;
      }
      await widget.mailboxRepository.updateMailbox(
        id: mailbox.id,
        label: label,
      );
      await _reload();
    } catch (e) {
      _showError(e);
    } finally {
      // Dialog exit animation may still reference the field.
      WidgetsBinding.instance.addPostFrameCallback((_) => ctrl.dispose());
    }
  }

  Future<void> _editFilters() async {
    final l10n = AppLocalizations.of(context);
    final mailbox = _selected;
    if (mailbox == null) return;
    final ctrl = TextEditingController(
      text: _filters.map((f) => f.pattern).join('\n'),
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.emailImportDomainFilters),
        content: TextField(
          controller: ctrl,
          maxLines: 8,
          decoration: InputDecoration(
            hintText: l10n.emailImportDomainFiltersHint,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.emailImportCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.emailImportSave),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final patterns = ctrl.text
        .split(RegExp(r'[\n,]'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    try {
      await widget.mailboxRepository.setDomainFilters(
        mailboxId: mailbox.id,
        patterns: patterns,
      );
      await _reload();
    } catch (e) {
      _showError(e);
    } finally {
      ctrl.dispose();
    }
  }

  Future<void> _sync() async {
    final mailbox = _selected;
    if (mailbox == null) return;
    try {
      await widget.mailboxRepository.triggerSync(mailbox.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).emailImportSyncQueued)),
      );
      await Future<void>.delayed(const Duration(seconds: 2));
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _generateTemplate(MailboxMessage message) async {
    if (_generatingTemplate) return;
    final l10n = AppLocalizations.of(context);
    setState(() => _generatingTemplate = true);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => PopScope(
        canPop: false,
        child: AlertDialog(
          content: LoadingView(message: l10n.emailImportGeneratingTemplate),
        ),
      ),
    );
    try {
      await widget.mailboxRepository.generateTemplate(messageId: message.id);
      if (!mounted) return;
      Navigator.of(context, rootNavigator: true).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.emailImportTemplateGenerated)),
      );
      await _reload();
      _tabs.animateTo(1);
    } catch (e) {
      if (mounted) {
        Navigator.of(context, rootNavigator: true).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.emailImportTemplateGenerationFailed)),
        );
      }
    } finally {
      if (mounted) setState(() => _generatingTemplate = false);
    }
  }

  Future<void> _editTemplate(ParsingTemplate template) async {
    final l10n = AppLocalizations.of(context);
    final nameCtrl = TextEditingController(text: template.name);
    final fromCtrl =
        TextEditingController(text: template.matchFromPattern);
    final subjectCtrl =
        TextEditingController(text: template.matchSubjectRegex ?? '');
    final extractorsCtrl =
        TextEditingController(text: template.extractorsJson);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.emailImportEditTemplate),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: InputDecoration(labelText: l10n.emailImportTemplateName),
              ),
              TextField(
                controller: fromCtrl,
                decoration:
                    InputDecoration(labelText: l10n.emailImportMatchFrom),
              ),
              TextField(
                controller: subjectCtrl,
                decoration:
                    InputDecoration(labelText: l10n.emailImportMatchSubject),
              ),
              TextField(
                controller: extractorsCtrl,
                maxLines: 10,
                decoration:
                    InputDecoration(labelText: l10n.emailImportExtractorsJson),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.emailImportCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.emailImportSave),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await widget.mailboxRepository.updateTemplate(
        id: template.id,
        name: nameCtrl.text.trim(),
        matchFromPattern: fromCtrl.text.trim(),
        matchSubjectRegex: subjectCtrl.text.trim(),
        extractorsJson: extractorsCtrl.text.trim(),
      );
      await _reload();
    } catch (e) {
      _showError(e);
    } finally {
      nameCtrl.dispose();
      fromCtrl.dispose();
      subjectCtrl.dispose();
      extractorsCtrl.dispose();
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
      await _reload();
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
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _viewSourceEmail(ExtractionArtifact artifact) async {
    final l10n = AppLocalizations.of(context);
    try {
      MailboxMessage? message;
      for (final m in _messages) {
        if (m.id == artifact.messageId) {
          message = m;
          break;
        }
      }
      message ??=
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

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.emailImportTitle),
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            Tab(text: l10n.emailImportTabSetup),
            Tab(text: l10n.emailImportTabTemplates),
            Tab(text: l10n.emailImportTabReview),
          ],
        ),
        actions: [
          IconButton(
            tooltip: l10n.tooltipRefresh,
            onPressed: _loading ? null : _reload,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorState(
                  message: _error!,
                  onRetry: _reload,
                  title: l10n.errorCouldNotLoad,
                  retryLabel: l10n.errorRetry,
                )
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _buildSetup(l10n),
                    _buildTemplates(l10n),
                    _buildReview(l10n),
                  ],
                ),
    );
  }

  Widget _buildSetup(AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.screen),
      children: [
        Text(
          l10n.emailImportSetupBlurb,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: AppSpacing.md),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            FilledButton.icon(
              onPressed: _createFixture,
              icon: const Icon(Icons.science_outlined),
              label: Text(l10n.emailImportAddFixture),
            ),
            OutlinedButton.icon(
              onPressed: _createGmail,
              icon: const Icon(Icons.mail_outline),
              label: Text(l10n.emailImportConnectGmail),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        if (_mailboxes.isEmpty)
          Text(l10n.emailImportNoMailbox)
        else ...[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
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
                    });
                    _reload();
                  },
                  decoration:
                      InputDecoration(labelText: l10n.emailImportMailbox),
                ),
              ),
              if (_selected != null) ...[
                const SizedBox(width: AppSpacing.xs),
                IconButton(
                  tooltip: l10n.emailImportRenameMailbox,
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _renameMailbox(_selected!),
                ),
                IconButton(
                  tooltip: l10n.emailImportDeleteMailbox,
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _confirmDeleteMailbox(_selected!),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.emailImportDomainFilters),
            subtitle: Text(
              _filters.isEmpty
                  ? l10n.emailImportNoFilters
                  : _filters.map((f) => f.pattern).join(', '),
            ),
            trailing: IconButton(
              icon: const Icon(Icons.edit),
              onPressed: _editFilters,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          FilledButton.tonalIcon(
            onPressed: _sync,
            icon: const Icon(Icons.sync),
            label: Text(l10n.emailImportTriggerSync),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            l10n.emailImportMessages,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppSpacing.sm),
          if (_messages.isEmpty)
            Text(l10n.emailImportNoMessages)
          else
            ..._messages.take(20).map(
                  (m) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(m.subject),
                    subtitle: Text(m.fromAddress),
                    trailing: IconButton(
                      tooltip: l10n.emailImportGenerateTemplate,
                      icon: const Icon(Icons.auto_awesome),
                      onPressed: _generatingTemplate
                          ? null
                          : () => _generateTemplate(m),
                    ),
                  ),
                ),
        ],
      ],
    );
  }

  Widget _buildTemplates(AppLocalizations l10n) {
    if (_selected == null) {
      return Center(child: Text(l10n.emailImportNoMailbox));
    }
    if (_templates.isEmpty) {
      return Center(child: Text(l10n.emailImportNoTemplates));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.screen),
      itemCount: _templates.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final t = _templates[i];
        return ListTile(
          title: Text(t.name),
          subtitle: Text(
            '${t.matchFromPattern}'
            '${t.matchSubjectRegex != null ? ' · /${t.matchSubjectRegex}/' : ''}'
            '${t.enabled ? '' : ' · disabled'}',
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Switch(
                value: t.enabled,
                onChanged: (v) async {
                  await widget.mailboxRepository
                      .updateTemplate(id: t.id, enabled: v);
                  await _reload();
                },
              ),
              IconButton(
                icon: const Icon(Icons.edit),
                onPressed: () => _editTemplate(t),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () async {
                  await widget.mailboxRepository.deleteTemplate(t.id);
                  await _reload();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReview(AppLocalizations l10n) {
    if (_pending.isEmpty) {
      return Center(child: Text(l10n.emailImportNoPending));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.screen),
      itemCount: _pending.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final a = _pending[i];
        final amount = a.amountCents == null
            ? '—'
            : formatMoney(a.amountCents!, currency: a.currency);
        return ListTile(
          title: Text(a.merchant ?? a.sourceSubject ?? 'Candidate #${a.id}'),
          subtitle: Text(
            '$amount · ${a.spentOn ?? '—'} · '
            '${(a.confidence * 100).round()}%',
          ),
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
    );
  }
}

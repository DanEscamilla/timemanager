import 'package:flutter/material.dart';
import 'package:app_core/app_core.dart';
import 'package:design_system/design_system.dart';
import 'package:go_router/go_router.dart';

import '../l10n/app_localizations.dart';
import '../l10n/exception_localizations.dart';
import '../models/mailbox.dart';
import '../router/app_routes.dart';
import '../services/gmail_oauth_launch.dart';
import '../services/mailbox_repository.dart';

/// Two-step wizard: configure mailbox, then sender allowlist (+ optional sync).
class EmailImportScreen extends StatefulWidget {
  const EmailImportScreen({
    super.key,
    required this.mailboxRepository,
  });

  final MailboxRepository mailboxRepository;

  @override
  State<EmailImportScreen> createState() => _EmailImportScreenState();
}

class _EmailImportScreenState extends State<EmailImportScreen> {
  bool _loading = true;
  String? _error;
  int _step = 0;
  List<MailboxAccount> _mailboxes = [];
  MailboxAccount? _selected;
  List<DomainFilter> _filters = [];
  final TextEditingController _filtersCtrl = TextEditingController();
  DateTime? _syncFrom = DateTime.now().subtract(const Duration(days: 30));
  DateTime? _syncTo = DateTime.now();

  @override
  void initState() {
    super.initState();
    _reload();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _handleGmailOAuthReturn();
    });
  }

  @override
  void dispose() {
    _filtersCtrl.dispose();
    super.dispose();
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

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final mailboxes = await widget.mailboxRepository.fetchMailboxes();
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
      if (selected != null) {
        filters =
            await widget.mailboxRepository.fetchDomainFilters(selected.id);
      }

      if (!mounted) return;
      setState(() {
        _mailboxes = mailboxes;
        _selected = selected;
        _filters = filters;
        _filtersCtrl.text = filters.map((f) => f.pattern).join('\n');
        _loading = false;
        if (mailboxes.isNotEmpty && _step == 0) {
          // Stay on step 0 so user can manage mailboxes; Next advances.
        }
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

  Future<void> _confirmClearInbox(MailboxAccount mailbox) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        final dialogL10n = AppLocalizations.of(context);
        return AlertDialog(
          title: Text(dialogL10n.emailImportClearInboxTitle),
          content: Text(dialogL10n.emailImportClearInboxConfirm),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(dialogL10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(dialogL10n.emailImportClearInbox),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    final l10n = AppLocalizations.of(context);
    try {
      await widget.mailboxRepository.clearInbox(mailbox.id);
      await _reload();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.emailImportClearInboxDone)),
      );
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
      WidgetsBinding.instance.addPostFrameCallback((_) => ctrl.dispose());
    }
  }

  Future<void> _saveFilters() async {
    final l10n = AppLocalizations.of(context);
    final mailbox = _selected;
    if (mailbox == null) return;
    final patterns = _filtersCtrl.text
        .split(RegExp(r'[\n,]'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (patterns.isEmpty) {
      _showError(l10n.emailImportFiltersRequired);
      return;
    }
    try {
      await widget.mailboxRepository.setDomainFilters(
        mailboxId: mailbox.id,
        patterns: patterns,
      );
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _sync() async {
    final mailbox = _selected;
    if (mailbox == null) return;
    final patterns = _filtersCtrl.text
        .split(RegExp(r'[\n,]'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (patterns.isEmpty && _filters.isEmpty) {
      _showError(AppLocalizations.of(context).emailImportFiltersRequired);
      return;
    }
    try {
      if (patterns.isNotEmpty) {
        await widget.mailboxRepository.setDomainFilters(
          mailboxId: mailbox.id,
          patterns: patterns,
        );
      }
      await widget.mailboxRepository.triggerSync(
        mailbox.id,
        since: _syncDateToIso(_syncFrom, endOfDay: false),
        until: _syncDateToIso(_syncTo, endOfDay: true),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).emailImportSyncQueued),
        ),
      );
      await _reload();
    } catch (e) {
      _showError(e);
    }
  }

  String? _syncDateToIso(DateTime? date, {required bool endOfDay}) {
    if (date == null) return null;
    final local = endOfDay
        ? DateTime(date.year, date.month, date.day, 23, 59, 59, 999)
        : DateTime(date.year, date.month, date.day);
    return local.toUtc().toIso8601String();
  }

  Future<void> _pickSyncDate({required bool isFrom}) async {
    final initial = (isFrom ? _syncFrom : _syncTo) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isFrom) {
        _syncFrom = picked;
        if (_syncTo != null && _syncTo!.isBefore(picked)) {
          _syncTo = picked;
        }
      } else {
        _syncTo = picked;
        if (_syncFrom != null && _syncFrom!.isAfter(picked)) {
          _syncFrom = picked;
        }
      }
    });
  }

  void _goNext() {
    if (_selected == null) {
      _showError(AppLocalizations.of(context).emailImportNoMailbox);
      return;
    }
    setState(() => _step = 1);
  }

  void _goBack() => setState(() => _step = 0);

  Future<void> _finish() async {
    await _saveFilters();
    if (!mounted) return;
    if (_filters.isEmpty &&
        _filtersCtrl.text
            .split(RegExp(r'[\n,]'))
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .isEmpty) {
      return;
    }
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.settings);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.emailImportTitle),
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
              : Column(
                  children: [
                    Expanded(
                      child: Stepper(
                        currentStep: _step,
                        onStepTapped: (i) {
                          if (i == 0) {
                            setState(() => _step = 0);
                          } else if (_selected != null) {
                            setState(() => _step = 1);
                          }
                        },
                        controlsBuilder: (context, details) {
                          return const SizedBox.shrink();
                        },
                        steps: [
                          Step(
                            title: Text(l10n.emailImportWizardStepMailbox),
                            isActive: _step >= 0,
                            state: _step > 0
                                ? StepState.complete
                                : StepState.indexed,
                            content: _buildMailboxStep(l10n),
                          ),
                          Step(
                            title: Text(l10n.emailImportWizardStepSenders),
                            isActive: _step >= 1,
                            state: _step >= 1
                                ? StepState.indexed
                                : StepState.disabled,
                            content: _buildSendersStep(l10n),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(AppSpacing.screen),
                      child: Row(
                        children: [
                          if (_step > 0)
                            TextButton(
                              onPressed: _goBack,
                              child: Text(l10n.emailImportWizardBack),
                            ),
                          const Spacer(),
                          if (_step == 0)
                            FilledButton(
                              onPressed:
                                  _mailboxes.isEmpty ? null : _goNext,
                              child: Text(l10n.emailImportWizardNext),
                            )
                          else ...[
                            OutlinedButton(
                              onPressed: _saveFilters,
                              child: Text(l10n.emailImportSave),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            FilledButton(
                              onPressed: _finish,
                              child: Text(l10n.emailImportWizardDone),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildMailboxStep(AppLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
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
        else
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
      ],
    );
  }

  Widget _buildSendersStep(AppLocalizations l10n) {
    if (_selected == null) {
      return Text(l10n.emailImportNoMailbox);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _filtersCtrl,
          maxLines: 8,
          decoration: InputDecoration(
            labelText: l10n.emailImportDomainFilters,
            hintText: l10n.emailImportDomainFiltersHint,
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => _pickSyncDate(isFrom: true),
                child: Text(
                  _syncFrom == null
                      ? l10n.emailImportSyncFrom
                      : '${l10n.emailImportSyncFrom}: ${MaterialLocalizations.of(context).formatShortDate(_syncFrom!)}',
                ),
              ),
            ),
            if (_syncFrom != null)
              IconButton(
                tooltip: l10n.emailImportSyncClearDate,
                icon: const Icon(Icons.clear),
                onPressed: () => setState(() => _syncFrom = null),
              ),
            const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: OutlinedButton(
                onPressed: () => _pickSyncDate(isFrom: false),
                child: Text(
                  _syncTo == null
                      ? l10n.emailImportSyncTo
                      : '${l10n.emailImportSyncTo}: ${MaterialLocalizations.of(context).formatShortDate(_syncTo!)}',
                ),
              ),
            ),
            if (_syncTo != null)
              IconButton(
                tooltip: l10n.emailImportSyncClearDate,
                icon: const Icon(Icons.clear),
                onPressed: () => setState(() => _syncTo = null),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        FilledButton.tonalIcon(
          onPressed: _sync,
          icon: const Icon(Icons.sync),
          label: Text(l10n.emailImportTriggerSync),
        ),
        const SizedBox(height: AppSpacing.md),
        TextButton.icon(
          onPressed: () => _confirmClearInbox(_selected!),
          icon: const Icon(Icons.delete_sweep_outlined),
          label: Text(l10n.emailImportClearInbox),
        ),
      ],
    );
  }
}

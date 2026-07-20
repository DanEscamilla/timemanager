import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../theme/tokens/app_spacing.dart';
import 'app_card.dart';

/// Collapsible "Advanced" section for create/edit forms.
///
/// Children stay mounted so [Form] validators still run when collapsed.
/// Call [AdvancedFormSectionState.expand] (via a [GlobalKey]) when validation
/// fails so hidden errors become visible.
class AdvancedFormSection extends StatefulWidget {
  const AdvancedFormSection({
    super.key,
    required this.initiallyExpanded,
    required this.hasConfiguredValues,
    required this.children,
  });

  final bool initiallyExpanded;
  final bool hasConfiguredValues;
  final List<Widget> children;

  @override
  State<AdvancedFormSection> createState() => AdvancedFormSectionState();
}

class AdvancedFormSectionState extends State<AdvancedFormSection> {
  late final ExpansionTileController _controller;
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
    _controller = ExpansionTileController();
  }

  /// Expands the section (e.g. after a validation failure).
  void expand() {
    if (_expanded) return;
    _controller.expand();
    setState(() => _expanded = true);
  }

  @override
  void didUpdateWidget(covariant AdvancedFormSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Auto-expand when configured values appear after async hydrate (edit).
    if (!oldWidget.hasConfiguredValues &&
        widget.hasConfiguredValues &&
        !_expanded) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) expand();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final showBadge = !_expanded && widget.hasConfiguredValues;

    return AppCard(
      padding: EdgeInsets.zero,
      child: Theme(
        data: theme.copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          controller: _controller,
          initiallyExpanded: widget.initiallyExpanded,
          tilePadding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.card,
            vertical: AppSpacing.xs,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            AppSpacing.card,
            0,
            AppSpacing.card,
            AppSpacing.card,
          ),
          shape: const Border(),
          collapsedShape: const Border(),
          title: Text(
            l10n.formAdvanced,
            style: theme.textTheme.titleSmall,
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (showBadge)
                Padding(
                  padding: const EdgeInsets.only(right: AppSpacing.sm),
                  child: Text(
                    l10n.formAdvancedConfigured,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
              Icon(_expanded ? Icons.expand_less : Icons.expand_more),
            ],
          ),
          onExpansionChanged: (expanded) {
            setState(() => _expanded = expanded);
          },
          children: widget.children,
        ),
      ),
    );
  }
}

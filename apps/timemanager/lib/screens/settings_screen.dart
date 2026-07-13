import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../theme/tokens/app_spacing.dart';
import '../widgets/app_card.dart';

/// Production settings: theme mode and sign out.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.themeMode,
    required this.onThemeModeChanged,
    this.onSignedOut,
  });

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;
  final Future<void> Function()? onSignedOut;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late ThemeMode _themeMode = widget.themeMode;

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.themeMode != widget.themeMode) {
      _themeMode = widget.themeMode;
    }
  }

  void _onThemeChanged(ThemeMode mode) {
    setState(() => _themeMode = mode);
    widget.onThemeModeChanged(mode);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.screen),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  l10n.settingsTheme,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: AppSpacing.sm),
                ThemeModeRadioGroup(
                  themeMode: _themeMode,
                  onChanged: _onThemeChanged,
                ),
              ],
            ),
          ),
          if (widget.onSignedOut != null) ...[
            const SizedBox(height: AppSpacing.md),
            AppCard(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  Icons.logout,
                  color: Theme.of(context).colorScheme.error,
                ),
                title: Text(l10n.settingsSignOut),
                onTap: () async {
                  Navigator.of(context).pop();
                  await widget.onSignedOut?.call();
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class ThemeModeRadioGroup extends StatelessWidget {
  const ThemeModeRadioGroup({
    super.key,
    required this.themeMode,
    required this.onChanged,
  });

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Column(
      children: [
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.settingsThemeSystem),
          value: ThemeMode.system,
          groupValue: themeMode,
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.settingsThemeLight),
          value: ThemeMode.light,
          groupValue: themeMode,
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.settingsThemeDark),
          value: ThemeMode.dark,
          groupValue: themeMode,
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
      ],
    );
  }
}

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'l10n/app_localizations.dart';
import 'services/locale_preference_service.dart';
import 'theme/app_theme.dart';
import 'widgets/auth_gate.dart';
import 'widgets/debug_menu.dart';

void main() {
  runApp(const TimeManagerApp());
}

class TimeManagerApp extends StatefulWidget {
  const TimeManagerApp({
    super.key,
    this.localePreferenceService,
  });

  final LocalePreferenceService? localePreferenceService;

  @override
  State<TimeManagerApp> createState() => _TimeManagerAppState();
}

class _TimeManagerAppState extends State<TimeManagerApp> {
  late final LocalePreferenceService _localePrefs =
      widget.localePreferenceService ?? LocalePreferenceService();

  Locale? _overrideLocale;

  @override
  void initState() {
    super.initState();
    _loadLocaleOverride();
  }

  Future<void> _loadLocaleOverride() async {
    final locale = await _localePrefs.load();
    if (!mounted) return;
    setState(() => _overrideLocale = locale);
  }

  Future<void> _onLocaleChanged(Locale? locale) async {
    setState(() => _overrideLocale = locale);
    await _localePrefs.save(locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      locale: _overrideLocale,
      theme: buildAppTheme(),
      debugShowCheckedModeBanner: false,
      builder: (context, child) {
        final content = child ?? const SizedBox.shrink();
        if (!kDebugMode) return content;
        return DebugMenuShell(
          localeOverride: _overrideLocale,
          onLocaleChanged: _onLocaleChanged,
          child: content,
        );
      },
      home: const AuthGate(),
    );
  }
}

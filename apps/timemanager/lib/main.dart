import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'l10n/app_localizations.dart';
import 'services/locale_preference_service.dart';
import 'services/theme_mode_preference_service.dart';
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
    this.themeModePreferenceService,
  });

  final LocalePreferenceService? localePreferenceService;
  final ThemeModePreferenceService? themeModePreferenceService;

  @override
  State<TimeManagerApp> createState() => _TimeManagerAppState();
}

class _TimeManagerAppState extends State<TimeManagerApp> {
  late final LocalePreferenceService _localePrefs =
      widget.localePreferenceService ?? LocalePreferenceService();
  late final ThemeModePreferenceService _themePrefs =
      widget.themeModePreferenceService ?? ThemeModePreferenceService();

  Locale? _overrideLocale;
  ThemeMode _themeMode = ThemeMode.system;

  @override
  void initState() {
    super.initState();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    final locale = await _localePrefs.load();
    final themeMode = await _themePrefs.load();
    if (!mounted) return;
    setState(() {
      _overrideLocale = locale;
      _themeMode = themeMode;
    });
  }

  Future<void> _onLocaleChanged(Locale? locale) async {
    setState(() => _overrideLocale = locale);
    await _localePrefs.save(locale);
  }

  Future<void> _onThemeModeChanged(ThemeMode mode) async {
    setState(() => _themeMode = mode);
    await _themePrefs.save(mode);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      locale: _overrideLocale,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: _themeMode,
      debugShowCheckedModeBanner: false,
      builder: (context, child) {
        final content = child ?? const SizedBox.shrink();
        if (!kDebugMode) return content;
        return DebugMenuShell(
          localeOverride: _overrideLocale,
          onLocaleChanged: _onLocaleChanged,
          themeMode: _themeMode,
          onThemeModeChanged: _onThemeModeChanged,
          child: content,
        );
      },
      home: AuthGate(
        onThemeModeChanged: _onThemeModeChanged,
        themeMode: _themeMode,
      ),
    );
  }
}

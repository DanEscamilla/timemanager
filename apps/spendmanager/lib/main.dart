import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:go_router/go_router.dart';

import 'l10n/app_localizations.dart';
import 'config/api_config.dart';
import 'router/app_router.dart';
import 'router/auth_controller.dart';
import 'services/locale_preference_service.dart';
import 'services/theme_mode_preference_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  ApiConfig.ensureConfigured();
  usePathUrlStrategy();
  runApp(const SpendManagerApp());
}

class SpendManagerApp extends StatefulWidget {
  const SpendManagerApp({
    super.key,
    this.localePreferenceService,
    this.themeModePreferenceService,
    this.authController,
  });

  final LocalePreferenceService? localePreferenceService;
  final ThemeModePreferenceService? themeModePreferenceService;
  final AuthController? authController;

  @override
  State<SpendManagerApp> createState() => _SpendManagerAppState();
}

class _SpendManagerAppState extends State<SpendManagerApp>
    with WidgetsBindingObserver {
  late final LocalePreferenceService _localePrefs =
      widget.localePreferenceService ?? LocalePreferenceService();
  late final ThemeModePreferenceService _themePrefs =
      widget.themeModePreferenceService ?? ThemeModePreferenceService();
  late final AuthController _auth =
      widget.authController ?? AuthController();

  final _rootNavigatorKey = GlobalKey<NavigatorState>();

  Locale? _overrideLocale;
  late final ValueNotifier<ThemeMode> _themeMode =
      ValueNotifier(ThemeMode.system);
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _router = createAppRouter(
      auth: _auth,
      rootNavigatorKey: _rootNavigatorKey,
      themeMode: _themeMode,
      onThemeModeChanged: _onThemeModeChanged,
    );
    _loadPreferences();
    _auth.bootstrap();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _themeMode.dispose();
    _router.dispose();
    _auth.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _auth.isSignedIn) {
      _auth.recordActivity();
    }
  }

  Future<void> _loadPreferences() async {
    final locale = await _localePrefs.load();
    final themeMode = await _themePrefs.load();
    if (!mounted) return;
    setState(() {
      _overrideLocale = locale;
    });
    _themeMode.value = themeMode;
  }

  Future<void> _onThemeModeChanged(ThemeMode mode) async {
    _themeMode.value = mode;
    await _themePrefs.save(mode);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: _themeMode,
      builder: (context, themeMode, _) {
        return MaterialApp.router(
          onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: _overrideLocale,
          theme: buildLightTheme(),
          darkTheme: buildDarkTheme(),
          themeMode: themeMode,
          debugShowCheckedModeBanner: false,
          routerConfig: _router,
          builder: (context, child) {
            final content = child ?? const SizedBox.shrink();
            return Listener(
              behavior: HitTestBehavior.translucent,
              onPointerDown: (_) => _auth.recordActivity(),
              onPointerSignal: (_) => _auth.recordActivity(),
              child: Focus(
                autofocus: true,
                onKeyEvent: (node, event) {
                  if (event is KeyDownEvent || event is KeyRepeatEvent) {
                    _auth.recordActivity();
                  }
                  return KeyEventResult.ignored;
                },
                child: content,
              ),
            );
          },
        );
      },
    );
  }
}

import 'package:flutter/material.dart';

import 'l10n/app_localizations.dart';
import 'theme/app_theme.dart';
import 'widgets/auth_gate.dart';

void main() {
  runApp(const TimeManagerApp());
}

class TimeManagerApp extends StatelessWidget {
  const TimeManagerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(),
      home: const AuthGate(),
    );
  }
}

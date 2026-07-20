import 'package:flutter/material.dart';

/// Radio group for choosing [ThemeMode] (system / light / dark).
///
/// Callers supply localized labels.
class ThemeModeRadioGroup extends StatelessWidget {
  const ThemeModeRadioGroup({
    super.key,
    required this.themeMode,
    required this.onChanged,
    required this.systemLabel,
    required this.lightLabel,
    required this.darkLabel,
  });

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onChanged;
  final String systemLabel;
  final String lightLabel;
  final String darkLabel;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(systemLabel),
          value: ThemeMode.system,
          groupValue: themeMode,
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(lightLabel),
          value: ThemeMode.light,
          groupValue: themeMode,
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        ),
        RadioListTile<ThemeMode>(
          contentPadding: EdgeInsets.zero,
          title: Text(darkLabel),
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

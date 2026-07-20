import 'package:flutter/material.dart';

import '../theme/tokens/app_radius.dart';

/// Tappable time field styled like a Material [InputDecorator].
class AppTimeField extends StatelessWidget {
  const AppTimeField({
    super.key,
    required this.label,
    required this.time,
    required this.onTap,
  });

  final String label;
  final TimeOfDay time;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final formatted = time.format(context);
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.borderMd,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: const Icon(Icons.schedule),
        ),
        child: Text(formatted),
      ),
    );
  }
}

/// Tappable date field styled like a Material [InputDecorator].
class AppDateField extends StatelessWidget {
  const AppDateField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.trailing,
  });

  final String label;
  final String value;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.borderMd,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: trailing ?? const Icon(Icons.calendar_today),
        ),
        child: Text(value),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/l10n/app_localizations.dart';
import 'package:timemanager/theme/app_theme.dart';
import 'package:timemanager/widgets/advanced_form_section.dart';

void main() {
  Future<void> pumpSection(
    WidgetTester tester, {
    required bool initiallyExpanded,
    required bool hasConfiguredValues,
    GlobalKey<AdvancedFormSectionState>? key,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildLightTheme(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: AdvancedFormSection(
            key: key,
            initiallyExpanded: initiallyExpanded,
            hasConfiguredValues: hasConfiguredValues,
            children: const [
              Text('advanced-child'),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('starts collapsed with Advanced header', (
    WidgetTester tester,
  ) async {
    await pumpSection(
      tester,
      initiallyExpanded: false,
      hasConfiguredValues: false,
    );

    expect(find.text('Advanced'), findsOneWidget);
    expect(find.byType(ExpansionTile), findsOneWidget);
  });

  testWidgets('shows configured badge when collapsed with values', (
    WidgetTester tester,
  ) async {
    await pumpSection(
      tester,
      initiallyExpanded: false,
      hasConfiguredValues: true,
    );

    expect(find.text('Configured'), findsOneWidget);
  });

  testWidgets('expands on tap and hides configured badge', (
    WidgetTester tester,
  ) async {
    await pumpSection(
      tester,
      initiallyExpanded: false,
      hasConfiguredValues: true,
    );

    expect(find.text('Configured'), findsOneWidget);

    await tester.tap(find.text('Advanced'));
    await tester.pumpAndSettle();

    expect(find.text('Configured'), findsNothing);
    expect(find.text('advanced-child'), findsOneWidget);
  });

  testWidgets('expand() reveals section when collapsed', (
    WidgetTester tester,
  ) async {
    final key = GlobalKey<AdvancedFormSectionState>();
    await pumpSection(
      tester,
      key: key,
      initiallyExpanded: false,
      hasConfiguredValues: true,
    );

    expect(find.text('Configured'), findsOneWidget);

    key.currentState!.expand();
    await tester.pumpAndSettle();

    expect(find.text('Configured'), findsNothing);
    expect(find.text('advanced-child'), findsOneWidget);
  });
}

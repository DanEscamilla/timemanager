import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:timemanager/main.dart';
import 'package:timemanager/screens/login_screen.dart';
import 'package:timemanager/widgets/debug_menu.dart';
import 'package:design_system/design_system.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('boots to login with debug menu shell', (WidgetTester tester) async {
    await tester.pumpWidget(const TimeManagerApp());
    await tester.pump(); // start async bootstrap / prefs

    // Auth bootstrap may still be in flight on the first frame.
    if (find.byType(LoadingView).evaluate().isNotEmpty) {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.byType(DebugMenuShell), findsOneWidget);
    expect(find.byType(Banner), findsOneWidget);
  });
}

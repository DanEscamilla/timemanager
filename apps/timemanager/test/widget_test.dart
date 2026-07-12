import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:timemanager/main.dart';

void main() {
  testWidgets('shows session bootstrap loading', (WidgetTester tester) async {
    await tester.pumpWidget(const TimeManagerApp());
    await tester.pump();

    // AuthGate checks session before routing to login or home.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}

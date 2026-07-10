import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:timemanager/main.dart';

void main() {
  testWidgets('shows activities screen', (WidgetTester tester) async {
    await tester.pumpWidget(const TimeManagerApp());
    await tester.pump();

    expect(find.text('Activities'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}

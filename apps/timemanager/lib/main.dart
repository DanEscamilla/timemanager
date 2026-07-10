import 'package:flutter/material.dart';

import 'screens/activities_screen.dart';

void main() {
  runApp(const TimeManagerApp());
}

class TimeManagerApp extends StatelessWidget {
  const TimeManagerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Time Manager',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      home: const ActivitiesScreen(),
    );
  }
}

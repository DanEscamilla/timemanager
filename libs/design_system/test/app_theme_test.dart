import 'package:design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  test('buildLightTheme and buildDarkTheme produce Material 3 themes', () {
    final light = buildLightTheme();
    final dark = buildDarkTheme();

    expect(light.useMaterial3, isTrue);
    expect(dark.useMaterial3, isTrue);
    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.extension<AppStatusColors>(), isNotNull);
    expect(dark.extension<AppStatusColors>(), isNotNull);
  });

  test('buildAppTheme aliases light theme', () {
    expect(buildAppTheme().brightness, Brightness.light);
  });
}

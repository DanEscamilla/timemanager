import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:design_system/design_system.dart';

void main() {
  group('parseEntityColor', () {
    test('parses #RRGGBB', () {
      expect(parseEntityColor('#0F766E'), const Color(0xFF0F766E));
    });

    test('parses RRGGBB without hash', () {
      expect(parseEntityColor('2563EB'), const Color(0xFF2563EB));
    });

    test('falls back to first palette color on invalid input', () {
      expect(
        parseEntityColor('not-a-color'),
        parseEntityColor(kEntityColorPalette.first),
      );
    });
  });

  group('aliases', () {
    test('parseGroupColor matches parseEntityColor', () {
      expect(parseGroupColor('#0F766E'), parseEntityColor('#0F766E'));
    });

    test('isAllowedEntityColor accepts palette colors', () {
      expect(isAllowedEntityColor('#0f766e'), isTrue);
      expect(isAllowedGroupColor('#FFFFFF'), isFalse);
    });
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:timemanager/models/group.dart';
import 'package:timemanager/theme/tokens/group_palette.dart';

void main() {
  group('parseGroupColor', () {
    test('parses #RRGGBB', () {
      expect(parseGroupColor('#0F766E'), const Color(0xFF0F766E));
    });

    test('parses RRGGBB without hash', () {
      expect(parseGroupColor('2563EB'), const Color(0xFF2563EB));
    });

    test('falls back to first palette color on invalid input', () {
      expect(
        parseGroupColor('not-a-color'),
        parseGroupColor(kGroupColorPalette.first),
      );
    });
  });

  group('isAllowedGroupColor', () {
    test('accepts palette colors case-insensitively', () {
      expect(isAllowedGroupColor('#0f766e'), isTrue);
      expect(isAllowedGroupColor('#FFFFFF'), isFalse);
    });
  });
}

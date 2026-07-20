import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Builds the app [TextTheme] with DS type roles.
///
/// Uses Plus Jakarta Sans via `google_fonts` when runtime fetching is allowed;
/// otherwise applies the same scale on the platform Material text theme (tests).
TextTheme buildAppTextTheme(Brightness brightness) {
  final base = brightness == Brightness.dark
      ? ThemeData(brightness: Brightness.dark).textTheme
      : ThemeData(brightness: Brightness.light).textTheme;

  final withFamily = GoogleFonts.config.allowRuntimeFetching
      ? GoogleFonts.plusJakartaSansTextTheme(base)
      : base;

  return _applyRoles(withFamily);
}

TextTheme _applyRoles(TextTheme source) {
  TextStyle style(
    TextStyle? from, {
    required double size,
    required FontWeight weight,
    required double height,
  }) {
    return (from ?? const TextStyle()).copyWith(
      fontSize: size,
      fontWeight: weight,
      height: height,
    );
  }

  return source.copyWith(
    displayLarge: style(
      source.displayLarge,
      size: 32,
      weight: FontWeight.w700,
      height: 1.25,
    ),
    displayMedium: style(
      source.displayMedium,
      size: 32,
      weight: FontWeight.w700,
      height: 1.25,
    ),
    displaySmall: style(
      source.displaySmall,
      size: 32,
      weight: FontWeight.w700,
      height: 1.25,
    ),
    headlineLarge: style(
      source.headlineLarge,
      size: 24,
      weight: FontWeight.w600,
      height: 1.3,
    ),
    headlineMedium: style(
      source.headlineMedium,
      size: 24,
      weight: FontWeight.w600,
      height: 1.3,
    ),
    headlineSmall: style(
      source.headlineSmall,
      size: 24,
      weight: FontWeight.w600,
      height: 1.3,
    ),
    titleLarge: style(
      source.titleLarge,
      size: 20,
      weight: FontWeight.w600,
      height: 1.3,
    ),
    titleMedium: style(
      source.titleMedium,
      size: 16,
      weight: FontWeight.w600,
      height: 1.4,
    ),
    titleSmall: style(
      source.titleSmall,
      size: 14,
      weight: FontWeight.w600,
      height: 1.4,
    ),
    bodyLarge: style(
      source.bodyLarge,
      size: 16,
      weight: FontWeight.w400,
      height: 1.5,
    ),
    bodyMedium: style(
      source.bodyMedium,
      size: 14,
      weight: FontWeight.w400,
      height: 1.5,
    ),
    bodySmall: style(
      source.bodySmall,
      size: 12,
      weight: FontWeight.w400,
      height: 1.4,
    ),
    labelLarge: style(
      source.labelLarge,
      size: 14,
      weight: FontWeight.w600,
      height: 1.2,
    ),
    labelMedium: style(
      source.labelMedium,
      size: 12,
      weight: FontWeight.w600,
      height: 1.2,
    ),
    labelSmall: style(
      source.labelSmall,
      size: 11,
      weight: FontWeight.w500,
      height: 1.2,
    ),
  );
}

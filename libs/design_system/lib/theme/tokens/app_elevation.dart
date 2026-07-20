/// Tonal elevation levels (prefer surface containers over heavy shadows).
abstract final class AppElevation {
  /// Flat on background (lists inside cards).
  static const double level0 = 0;

  /// Default cards.
  static const double level1 = 1;

  /// Floating menus / scrolled-under app bar.
  static const double level2 = 2;

  /// Modals and sheets (scrim handles separation).
  static const double level3 = 3;
}

import 'package:flutter/material.dart';

/// Debug-only shell: bottom-left DEBUG control opens a drawer with overrides.
class DebugMenuShell extends StatefulWidget {
  const DebugMenuShell({
    super.key,
    required this.child,
    required this.localeOverride,
    required this.onLocaleChanged,
  });

  final Widget child;
  final Locale? localeOverride;
  final ValueChanged<Locale?> onLocaleChanged;

  @override
  State<DebugMenuShell> createState() => _DebugMenuShellState();
}

class _DebugMenuShellState extends State<DebugMenuShell> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  void _openDrawer() {
    _scaffoldKey.currentState?.openDrawer();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      drawer: DebugDrawer(
        localeOverride: widget.localeOverride,
        onLocaleChanged: widget.onLocaleChanged,
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          Banner(
            message: 'DEBUG',
            location: BannerLocation.bottomStart,
            color: const Color(0xA0B71C1C),
            textStyle: const TextStyle(
              color: Color(0xFFFFFFFF),
              fontSize: 12.0 * 0.85,
              fontWeight: FontWeight.w900,
              height: 1.0,
            ),
            child: widget.child,
          ),
          Positioned(
            left: 0,
            bottom: 0,
            width: 72,
            height: 72,
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: _openDrawer,
              child: const SizedBox.expand(),
            ),
          ),
        ],
      ),
    );
  }
}

/// Developer drawer for forcing app behavior (locale, etc.).
class DebugDrawer extends StatelessWidget {
  const DebugDrawer({
    super.key,
    required this.localeOverride,
    required this.onLocaleChanged,
  });

  final Locale? localeOverride;
  final ValueChanged<Locale?> onLocaleChanged;

  String get _selectedKey {
    final code = localeOverride?.languageCode;
    if (code == 'en' || code == 'es') return code!;
    return 'system';
  }

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            const DrawerHeader(
              decoration: BoxDecoration(
                color: Color(0xA0B71C1C),
              ),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  'Debug',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const ListTile(
              title: Text(
                'Locale',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text('Override app language (persisted)'),
            ),
            RadioListTile<String>(
              title: const Text('System'),
              value: 'system',
              groupValue: _selectedKey,
              onChanged: (_) => onLocaleChanged(null),
            ),
            RadioListTile<String>(
              title: const Text('English'),
              value: 'en',
              groupValue: _selectedKey,
              onChanged: (_) => onLocaleChanged(const Locale('en')),
            ),
            RadioListTile<String>(
              title: const Text('Spanish'),
              value: 'es',
              groupValue: _selectedKey,
              onChanged: (_) => onLocaleChanged(const Locale('es')),
            ),
          ],
        ),
      ),
    );
  }
}

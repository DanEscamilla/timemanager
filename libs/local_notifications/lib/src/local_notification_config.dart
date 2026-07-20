/// Per-app Android channel + prefs cache identity.
class LocalNotificationConfig {
  const LocalNotificationConfig({
    required this.androidChannelId,
    required this.androidChannelName,
    required this.androidChannelDescription,
    required this.cacheKey,
  });

  final String androidChannelId;
  final String androidChannelName;
  final String androidChannelDescription;

  /// SharedPreferences key used to persist the last scheduled plan.
  final String cacheKey;
}

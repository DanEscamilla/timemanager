/// Per-app identity for push registration.
class PushNotificationConfig {
  const PushNotificationConfig({
    required this.appId,
  });

  /// Product app id (e.g. `spendmanager`, `timemanager`).
  final String appId;
}

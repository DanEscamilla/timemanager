import '../models/goal.dart';

export 'date_only.dart' show dateToIso;

/// Composite key for an activity occurrence completion.
String completionKey(int activityId, String occurrenceDate) =>
    '$activityId|$occurrenceDate';

/// Indexes completions by [completionKey] for fast calendar lookups.
Map<String, ActivityCompletion> indexCompletions(
  Iterable<ActivityCompletion> completions,
) {
  final map = <String, ActivityCompletion>{};
  for (final c in completions) {
    map[completionKey(c.activityId, c.occurrenceDate)] = c;
  }
  return map;
}

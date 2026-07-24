import 'package:flutter_test/flutter_test.dart';
import 'package:spendmanager/models/mailbox.dart';

void main() {
  group('ExtractionArtifact.templateId', () {
    test('returns null when payload has no templateId', () {
      final a = ExtractionArtifact(
        id: 1,
        messageId: 10,
        kind: 'spending.candidate',
        payload: {
          'amountCents': 100,
          'currency': 'USD',
          'spentOn': '2026-07-01',
        },
        confidence: 0.5,
        status: 'pending',
        createdAt: DateTime.utc(2026, 7, 1),
        updatedAt: DateTime.utc(2026, 7, 1),
      );
      expect(a.templateId, isNull);
    });

    test('returns int when payload has templateId', () {
      final a = ExtractionArtifact.fromJson({
        'id': 1,
        'message_id': 10,
        'kind': 'spending.candidate',
        'payload':
            '{"amountCents":100,"spentOn":"2026-07-01","templateId":7}',
        'confidence': 0.9,
        'status': 'pending',
        'created_at': '2026-07-01T00:00:00.000Z',
        'updated_at': '2026-07-01T00:00:00.000Z',
      });
      expect(a.templateId, 7);
    });
  });

  group('GenerateTemplateResult', () {
    test('parses nested template and reevaluatedCount', () {
      final result = GenerateTemplateResult.fromJson({
        'template': {
          'id': 3,
          'mailbox_id': 1,
          'user_id': 1,
          'name': 'Shop',
          'kind': 'approve',
          'enabled': true,
          'match_from_pattern': 'shop.com',
          'match_subject_regex': null,
          'extractors': '{}',
          'source_message_id': 10,
          'version': 1,
          'created_at': '2026-07-01T00:00:00.000Z',
          'updated_at': '2026-07-01T00:00:00.000Z',
        },
        'reevaluatedCount': 4,
      });
      expect(result.template.id, 3);
      expect(result.reevaluatedCount, 4);
    });
  });
}

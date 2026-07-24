import 'dart:convert';

import '../utils/json_dates.dart';

class MailboxAccount {
  MailboxAccount({
    required this.id,
    required this.userId,
    required this.provider,
    required this.label,
    required this.enabled,
    this.syncCursor,
    required this.syncRequested,
    this.syncSince,
    this.syncUntil,
    this.lastSyncedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int userId;
  final String provider;
  final String label;
  final bool enabled;
  final String? syncCursor;
  final bool syncRequested;
  final DateTime? syncSince;
  final DateTime? syncUntil;
  final DateTime? lastSyncedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory MailboxAccount.fromJson(Map<String, dynamic> json) {
    return MailboxAccount(
      id: asInt(json['id']),
      userId: asInt(json['user_id']),
      provider: json['provider'] as String,
      label: json['label'] as String,
      enabled: json['enabled'] as bool? ?? true,
      syncCursor: json['sync_cursor'] as String?,
      syncRequested: json['sync_requested'] as bool? ?? false,
      syncSince: parseJsonDateOrNull(json['sync_since']),
      syncUntil: parseJsonDateOrNull(json['sync_until']),
      lastSyncedAt: parseJsonDateOrNull(json['last_synced_at']),
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }
}

class DomainFilter {
  DomainFilter({
    required this.id,
    required this.mailboxId,
    required this.pattern,
    required this.createdAt,
  });

  final int id;
  final int mailboxId;
  final String pattern;
  final DateTime createdAt;

  factory DomainFilter.fromJson(Map<String, dynamic> json) {
    return DomainFilter(
      id: asInt(json['id']),
      mailboxId: asInt(json['mailbox_id']),
      pattern: json['pattern'] as String,
      createdAt: parseJsonDate(json['created_at']),
    );
  }
}

class MailboxMessage {
  MailboxMessage({
    required this.id,
    required this.mailboxId,
    required this.providerMessageId,
    required this.rfcMessageId,
    required this.fromAddress,
    required this.subject,
    required this.receivedAt,
    this.textBody,
    required this.createdAt,
  });

  final int id;
  final int mailboxId;
  final String providerMessageId;
  final String rfcMessageId;
  final String fromAddress;
  final String subject;
  final DateTime receivedAt;
  final String? textBody;
  final DateTime createdAt;

  factory MailboxMessage.fromJson(Map<String, dynamic> json) {
    return MailboxMessage(
      id: asInt(json['id']),
      mailboxId: asInt(json['mailbox_id']),
      providerMessageId: json['provider_message_id'] as String,
      rfcMessageId: json['rfc_message_id'] as String,
      fromAddress: json['from_address'] as String,
      subject: json['subject'] as String,
      receivedAt: parseJsonDate(json['received_at']),
      textBody: json['text_body'] as String?,
      createdAt: parseJsonDate(json['created_at']),
    );
  }
}

class ExtractionArtifact {
  ExtractionArtifact({
    required this.id,
    required this.messageId,
    required this.kind,
    required this.payload,
    required this.confidence,
    required this.status,
    this.publishedExpenseId,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int messageId;
  final String kind;
  final Map<String, dynamic> payload;
  final double confidence;
  final String status;
  final int? publishedExpenseId;
  final DateTime createdAt;
  final DateTime updatedAt;

  int? get amountCents {
    final v = payload['amountCents'];
    if (v is int) return v;
    if (v is num) return v.toInt();
    return null;
  }

  String get currency => (payload['currency'] as String?) ?? 'USD';
  String? get merchant => payload['merchant'] as String?;
  String? get spentOn => payload['spentOn'] as String?;
  String? get sourceSubject => payload['sourceSubject'] as String?;

  /// Parsing template id when extracted via a template; null for fallback.
  int? get templateId {
    final v = payload['templateId'];
    if (v is int) return v;
    if (v is num) return v.toInt();
    return null;
  }

  factory ExtractionArtifact.fromJson(Map<String, dynamic> json) {
    final rawPayload = json['payload'];
    final Map<String, dynamic> payload;
    if (rawPayload is String) {
      if (rawPayload.isEmpty) {
        payload = {};
      } else {
        payload = Map<String, dynamic>.from(
          jsonDecode(rawPayload) as Map,
        );
      }
    } else if (rawPayload is Map) {
      payload = Map<String, dynamic>.from(rawPayload);
    } else {
      payload = {};
    }

    return ExtractionArtifact(
      id: asInt(json['id']),
      messageId: asInt(json['message_id']),
      kind: json['kind'] as String,
      payload: payload,
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      status: json['status'] as String,
      publishedExpenseId: json['published_expense_id'] == null
          ? null
          : asInt(json['published_expense_id']),
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }
}

class ExtractionArtifactPage {
  ExtractionArtifactPage({
    required this.items,
    required this.totalCount,
    required this.page,
    required this.pageSize,
  });

  final List<ExtractionArtifact> items;
  final int totalCount;
  final int page;
  final int pageSize;

  int get totalPages =>
      totalCount == 0 ? 1 : ((totalCount + pageSize - 1) / pageSize).floor();

  factory ExtractionArtifactPage.fromJson(Map<String, dynamic> json) {
    final list = json['items'] as List<dynamic>? ?? [];
    return ExtractionArtifactPage(
      items: list
          .map((e) => ExtractionArtifact.fromJson(e as Map<String, dynamic>))
          .toList(),
      totalCount: asInt(json['totalCount'] ?? json['total_count'] ?? 0),
      page: asInt(json['page'] ?? 1),
      pageSize: asInt(json['pageSize'] ?? json['page_size'] ?? 20),
    );
  }
}

class ParsingTemplate {
  ParsingTemplate({
    required this.id,
    required this.mailboxId,
    required this.userId,
    required this.name,
    required this.kind,
    required this.enabled,
    required this.matchFromPattern,
    this.matchSubjectRegex,
    this.extractorsJson,
    this.sourceMessageId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int mailboxId;
  final int userId;
  final String name;
  /// `approve` | `reject`
  final String kind;
  final bool enabled;
  final String matchFromPattern;
  final String? matchSubjectRegex;
  /// Null for reject (match-only) templates.
  final String? extractorsJson;
  final int? sourceMessageId;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isApprove => kind == 'approve';
  bool get isReject => kind == 'reject';

  factory ParsingTemplate.fromJson(Map<String, dynamic> json) {
    final extractors = json['extractors'];
    String? extractorsJson;
    if (extractors == null) {
      extractorsJson = null;
    } else if (extractors is String) {
      extractorsJson = extractors;
    } else {
      extractorsJson = jsonEncode(extractors);
    }
    return ParsingTemplate(
      id: asInt(json['id']),
      mailboxId: asInt(json['mailbox_id']),
      userId: asInt(json['user_id']),
      name: json['name'] as String,
      kind: (json['kind'] as String?) ?? 'approve',
      enabled: json['enabled'] as bool? ?? true,
      matchFromPattern: json['match_from_pattern'] as String,
      matchSubjectRegex: json['match_subject_regex'] as String?,
      extractorsJson: extractorsJson,
      sourceMessageId: json['source_message_id'] == null
          ? null
          : asInt(json['source_message_id']),
      version: asInt(json['version'] ?? 1),
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }
}

/// Result of [MailboxRepository.generateTemplate].
class GenerateTemplateResult {
  GenerateTemplateResult({
    required this.template,
    required this.reevaluatedCount,
  });

  final ParsingTemplate template;
  final int reevaluatedCount;

  factory GenerateTemplateResult.fromJson(Map<String, dynamic> json) {
    return GenerateTemplateResult(
      template: ParsingTemplate.fromJson(
        json['template'] as Map<String, dynamic>,
      ),
      reevaluatedCount: asInt(json['reevaluatedCount'] ?? 0),
    );
  }
}

int asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.parse('$value');
}

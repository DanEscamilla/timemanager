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
    this.htmlBody,
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
  final String? htmlBody;
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
      htmlBody: json['html_body'] as String?,
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

class ParsingTemplate {
  ParsingTemplate({
    required this.id,
    required this.mailboxId,
    required this.userId,
    required this.name,
    required this.enabled,
    required this.matchFromPattern,
    this.matchSubjectRegex,
    required this.extractorsJson,
    this.sourceMessageId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final int id;
  final int mailboxId;
  final int userId;
  final String name;
  final bool enabled;
  final String matchFromPattern;
  final String? matchSubjectRegex;
  final String extractorsJson;
  final int? sourceMessageId;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory ParsingTemplate.fromJson(Map<String, dynamic> json) {
    final extractors = json['extractors'];
    return ParsingTemplate(
      id: asInt(json['id']),
      mailboxId: asInt(json['mailbox_id']),
      userId: asInt(json['user_id']),
      name: json['name'] as String,
      enabled: json['enabled'] as bool? ?? true,
      matchFromPattern: json['match_from_pattern'] as String,
      matchSubjectRegex: json['match_subject_regex'] as String?,
      extractorsJson: extractors is String
          ? extractors
          : jsonEncode(extractors ?? {}),
      sourceMessageId: json['source_message_id'] == null
          ? null
          : asInt(json['source_message_id']),
      version: asInt(json['version'] ?? 1),
      createdAt: parseJsonDate(json['created_at']),
      updatedAt: parseJsonDate(json['updated_at']),
    );
  }
}

int asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.parse('$value');
}

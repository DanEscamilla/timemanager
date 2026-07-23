import '../config/api_config.dart';
import '../models/mailbox.dart';
import 'graphql_client.dart';

/// GraphQL client for mailbox-api (`:3003`), separate from spendmanager-api.
///
/// mailbox-api Pylon schema uses flat field args (`input:`, `mailboxId:`, …),
/// not the `args: { … }` wrapper used by spendmanager-api.
class MailboxRepository {
  MailboxRepository({GraphQLClient? client})
      : _client = client ??
            GraphQLClient(endpoint: ApiConfig.mailboxGraphqlEndpoint);

  final GraphQLClient _client;

  Future<List<MailboxAccount>> fetchMailboxes() async {
    final data = await _client.query('''
      query {
        mailboxes {
          id user_id provider label enabled sync_cursor sync_requested
          last_synced_at created_at updated_at
        }
      }
    ''');
    final list = data['mailboxes'] as List<dynamic>? ?? [];
    return list
        .map((e) => MailboxAccount.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<MailboxAccount> createMailbox({
    required String provider,
    required String label,
    List<String>? domainFilters,
    bool enabled = true,
  }) async {
    final data = await _client.mutate('''
      mutation CreateMailbox(\$input: CreateMailboxInputInput!) {
        createMailbox(input: \$input) {
          id user_id provider label enabled sync_cursor sync_requested
          last_synced_at created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'provider': provider,
        'label': label,
        'enabled': enabled,
        if (domainFilters != null) 'domainFilters': domainFilters,
      },
    });
    return MailboxAccount.fromJson(
      data['createMailbox'] as Map<String, dynamic>,
    );
  }

  Future<MailboxAccount> updateMailbox({
    required int id,
    required String label,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateMailbox(\$input: UpdateMailboxInputInput!) {
        updateMailbox(input: \$input) {
          id user_id provider label enabled sync_cursor sync_requested
          last_synced_at created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'id': id,
        'label': label,
      },
    });
    return MailboxAccount.fromJson(
      data['updateMailbox'] as Map<String, dynamic>,
    );
  }

  Future<bool> deleteMailbox(int id) async {
    final data = await _client.mutate('''
      mutation DeleteMailbox(\$id: Number!) {
        deleteMailbox(id: \$id)
      }
    ''', variables: {'id': id});
    return data['deleteMailbox'] as bool? ?? false;
  }

  Future<List<DomainFilter>> fetchDomainFilters(int mailboxId) async {
    final data = await _client.query('''
      query DomainFilters(\$mailboxId: Number!) {
        domainFilters(mailboxId: \$mailboxId) {
          id mailbox_id pattern created_at
        }
      }
    ''', variables: {'mailboxId': mailboxId});
    final list = data['domainFilters'] as List<dynamic>? ?? [];
    return list
        .map((e) => DomainFilter.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<DomainFilter>> setDomainFilters({
    required int mailboxId,
    required List<String> patterns,
  }) async {
    final data = await _client.mutate('''
      mutation SetDomainFilters(\$input: SetDomainFiltersInputInput!) {
        setDomainFilters(input: \$input) {
          id mailbox_id pattern created_at
        }
      }
    ''', variables: {
      'input': {
        'mailboxId': mailboxId,
        'patterns': patterns,
      },
    });
    final list = data['setDomainFilters'] as List<dynamic>? ?? [];
    return list
        .map((e) => DomainFilter.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<MailboxAccount> triggerSync(int mailboxId) async {
    final data = await _client.mutate('''
      mutation TriggerSync(\$mailboxId: Number!) {
        triggerSync(mailboxId: \$mailboxId) {
          id user_id provider label enabled sync_cursor sync_requested
          last_synced_at created_at updated_at
        }
      }
    ''', variables: {'mailboxId': mailboxId});
    return MailboxAccount.fromJson(
      data['triggerSync'] as Map<String, dynamic>,
    );
  }

  Future<MailboxAccount> connectGmail({
    required int mailboxId,
    required String accessToken,
    String? refreshToken,
    double? expiresAtMs,
  }) async {
    final data = await _client.mutate('''
      mutation ConnectGmail(\$input: ConnectGmailInputInput!) {
        connectGmail(input: \$input) {
          id user_id provider label enabled sync_cursor sync_requested
          last_synced_at created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'mailboxId': mailboxId,
        'accessToken': accessToken,
        if (refreshToken != null) 'refreshToken': refreshToken,
        if (expiresAtMs != null) 'expiresAtMs': expiresAtMs,
      },
    });
    return MailboxAccount.fromJson(
      data['connectGmail'] as Map<String, dynamic>,
    );
  }

  /// Returns Google's authorize URL; mailbox-api completes the code exchange.
  Future<String> startGmailOAuth({
    required int mailboxId,
    required String returnTo,
  }) async {
    final data = await _client.mutate('''
      mutation StartGmailOAuth(\$input: StartGmailOAuthInputInput!) {
        startGmailOAuth(input: \$input) {
          authorizationUrl
        }
      }
    ''', variables: {
      'input': {
        'mailboxId': mailboxId,
        'returnTo': returnTo,
      },
    });
    final payload = data['startGmailOAuth'] as Map<String, dynamic>?;
    final url = payload?['authorizationUrl'] as String?;
    if (url == null || url.isEmpty) {
      throw GraphQLException('startGmailOAuth missing authorizationUrl');
    }
    return url;
  }

  Future<List<MailboxMessage>> fetchMessages(int mailboxId) async {
    final data = await _client.query('''
      query Messages(\$mailboxId: Number!) {
        messages(mailboxId: \$mailboxId) {
          id mailbox_id provider_message_id rfc_message_id from_address
          subject received_at text_body html_body created_at
        }
      }
    ''', variables: {'mailboxId': mailboxId});
    final list = data['messages'] as List<dynamic>? ?? [];
    return list
        .map((e) => MailboxMessage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<MailboxMessage?> fetchMessage(int id) async {
    final data = await _client.query('''
      query Message(\$id: Number!) {
        message(id: \$id) {
          id mailbox_id provider_message_id rfc_message_id from_address
          subject received_at text_body html_body created_at
        }
      }
    ''', variables: {'id': id});
    final raw = data['message'];
    if (raw == null) return null;
    return MailboxMessage.fromJson(raw as Map<String, dynamic>);
  }

  Future<MailboxMessage?> fetchSourceMessageForExpense(int expenseId) async {
    final data = await _client.query('''
      query SourceMessageForExpense(\$expenseId: Number!) {
        sourceMessageForExpense(expenseId: \$expenseId) {
          id mailbox_id provider_message_id rfc_message_id from_address
          subject received_at text_body html_body created_at
        }
      }
    ''', variables: {'expenseId': expenseId});
    final raw = data['sourceMessageForExpense'];
    if (raw == null) return null;
    return MailboxMessage.fromJson(raw as Map<String, dynamic>);
  }

  Future<List<ExtractionArtifact>> fetchArtifacts({
    int? mailboxId,
    String? status,
  }) async {
    final data = await _client.query('''
      query Artifacts(\$mailboxId: Number, \$status: String) {
        extractionArtifacts(mailboxId: \$mailboxId, status: \$status) {
          id message_id kind payload confidence status
          published_expense_id created_at updated_at
        }
      }
    ''', variables: {
      'mailboxId': mailboxId,
      'status': status,
    });
    final list = data['extractionArtifacts'] as List<dynamic>? ?? [];
    return list
        .map((e) => ExtractionArtifact.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ExtractionArtifact> updateArtifactStatus({
    required int artifactId,
    required String status,
    int? categoryId,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateArtifact(\$input: UpdateArtifactStatusInputInput!) {
        updateArtifactStatus(input: \$input) {
          id message_id kind payload confidence status
          published_expense_id created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'artifactId': artifactId,
        'status': status,
        if (categoryId != null) 'categoryId': categoryId,
      },
    });
    return ExtractionArtifact.fromJson(
      data['updateArtifactStatus'] as Map<String, dynamic>,
    );
  }

  Future<List<ParsingTemplate>> fetchTemplates(int mailboxId) async {
    final data = await _client.query('''
      query Templates(\$mailboxId: Number!) {
        parsingTemplates(mailboxId: \$mailboxId) {
          id mailbox_id user_id name enabled match_from_pattern
          match_subject_regex extractors source_message_id version
          created_at updated_at
        }
      }
    ''', variables: {'mailboxId': mailboxId});
    final list = data['parsingTemplates'] as List<dynamic>? ?? [];
    return list
        .map((e) => ParsingTemplate.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ParsingTemplate> generateTemplate({
    required int messageId,
    String? name,
    String? hints,
  }) async {
    final data = await _client.mutate('''
      mutation GenerateTemplate(\$input: GenerateParsingTemplateInputInput!) {
        generateParsingTemplate(input: \$input) {
          id mailbox_id user_id name enabled match_from_pattern
          match_subject_regex extractors source_message_id version
          created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'messageId': messageId,
        if (name != null) 'name': name,
        if (hints != null) 'hints': hints,
      },
    });
    return ParsingTemplate.fromJson(
      data['generateParsingTemplate'] as Map<String, dynamic>,
    );
  }

  Future<ParsingTemplate> updateTemplate({
    required int id,
    String? name,
    String? matchFromPattern,
    String? matchSubjectRegex,
    String? extractorsJson,
    bool? enabled,
  }) async {
    final data = await _client.mutate('''
      mutation UpdateTemplate(\$input: UpdateParsingTemplateInputInput!) {
        updateParsingTemplate(input: \$input) {
          id mailbox_id user_id name enabled match_from_pattern
          match_subject_regex extractors source_message_id version
          created_at updated_at
        }
      }
    ''', variables: {
      'input': {
        'id': id,
        if (name != null) 'name': name,
        if (matchFromPattern != null) 'matchFromPattern': matchFromPattern,
        if (matchSubjectRegex != null) 'matchSubjectRegex': matchSubjectRegex,
        if (extractorsJson != null) 'extractorsJson': extractorsJson,
        if (enabled != null) 'enabled': enabled,
      },
    });
    return ParsingTemplate.fromJson(
      data['updateParsingTemplate'] as Map<String, dynamic>,
    );
  }

  Future<bool> deleteTemplate(int id) async {
    final data = await _client.mutate('''
      mutation DeleteTemplate(\$id: Number!) {
        deleteParsingTemplate(id: \$id)
      }
    ''', variables: {'id': id});
    return data['deleteParsingTemplate'] as bool? ?? false;
  }
}

// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Spend Manager';

  @override
  String get navOverview => 'Overview';

  @override
  String get navExpenses => 'Expenses';

  @override
  String get navCategories => 'Categories';

  @override
  String get navBudgets => 'Budgets';

  @override
  String get tooltipRefresh => 'Refresh';

  @override
  String get tooltipSignOut => 'Sign out';

  @override
  String get tooltipSettings => 'Settings';

  @override
  String get tooltipAddExpense => 'Add expense';

  @override
  String get tooltipAddCategory => 'Add category';

  @override
  String get tooltipAddBudget => 'Add budget';

  @override
  String get loginCreateAccount => 'Create an account';

  @override
  String get loginSignInContinue => 'Sign in to continue';

  @override
  String get loginEmail => 'Email';

  @override
  String get loginEmailRequired => 'Email is required';

  @override
  String get loginEmailInvalid => 'Enter a valid email';

  @override
  String get loginPassword => 'Password';

  @override
  String get loginPasswordRequired => 'Password is required';

  @override
  String get loginPasswordTooShort => 'Use at least 8 characters';

  @override
  String get loginShowPassword => 'Show password';

  @override
  String get loginHidePassword => 'Hide password';

  @override
  String get loginRememberDevice => 'Remember this device';

  @override
  String get loginSignUp => 'Sign up';

  @override
  String get loginSignIn => 'Sign in';

  @override
  String get loginAlreadyHaveAccount => 'Already have an account? Sign in';

  @override
  String get loginNeedAccount => 'Need an account? Sign up';

  @override
  String get loginOrContinueWith => 'Or continue with';

  @override
  String get providerGoogle => 'Google';

  @override
  String get providerGitHub => 'GitHub';

  @override
  String get providerApple => 'Apple';

  @override
  String get providerTwitter => 'Twitter';

  @override
  String get authActionSignUp => 'Sign up';

  @override
  String get authActionSignIn => 'Sign in';

  @override
  String get authActionOAuth => 'OAuth sign in';

  @override
  String authFailedStatus(String action, String status) {
    return '$action failed ($status)';
  }

  @override
  String authNoSessionToken(String action) {
    return '$action succeeded but no session token was returned';
  }

  @override
  String authStartOAuthFailed(String provider, int statusCode) {
    return 'Failed to start $provider login ($statusCode)';
  }

  @override
  String get authAuthorisationUrlMissing =>
      'Authorisation URL missing from response';

  @override
  String get authCouldNotGetAuthorisationUrl =>
      'Could not get authorisation URL';

  @override
  String authCouldNotOpenLogin(String provider) {
    return 'Could not open $provider login';
  }

  @override
  String get errorNotSignedIn => 'Not signed in';

  @override
  String get errorSessionExpired => 'Session expired. Please sign in again.';

  @override
  String errorRequestFailed(int statusCode, String body) {
    return 'Request failed ($statusCode): $body';
  }

  @override
  String get errorNoGraphQlData => 'No data in GraphQL response';

  @override
  String get errorUnknown => 'Unknown error';

  @override
  String get errorCouldNotLoad => 'Could not load data';

  @override
  String get errorRetry => 'Retry';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get delete => 'Delete';

  @override
  String get archive => 'Archive';

  @override
  String get expensesTabHistory => 'History';

  @override
  String get expensesTabReview => 'Review';

  @override
  String get expensesEmptyTitle => 'No expenses yet';

  @override
  String get expensesEmptyHint => 'Tap + to log your first spend.';

  @override
  String get expensesEmptyAction => 'Add expense';

  @override
  String get expensesReviewSetupRequiredTitle => 'Email import not set up';

  @override
  String get expensesReviewSetupRequiredHint =>
      'Connect a mailbox and allow sender domains to import spending from email.';

  @override
  String get expensesReviewSetupCta => 'Set up email import';

  @override
  String get expensesDeleteTitle => 'Delete expense?';

  @override
  String get expensesDeleteConfirm => 'Remove this expense?';

  @override
  String get expensesFormNew => 'New expense';

  @override
  String get expensesFormEdit => 'Edit expense';

  @override
  String get expensesFormAmount => 'Amount';

  @override
  String get expensesFormAmountRequired => 'Enter an amount';

  @override
  String get expensesFormAmountInvalid => 'Enter a valid amount (e.g. 12.50)';

  @override
  String get expensesFormCategory => 'Category';

  @override
  String get expensesFormCategoryRequired => 'Pick a category';

  @override
  String get expensesFormDate => 'Date';

  @override
  String get expensesFormNote => 'Note';

  @override
  String get expensesFormCurrency => 'Currency';

  @override
  String get categoriesEmptyTitle => 'No categories yet';

  @override
  String get categoriesEmptyHint => 'Create categories to organize spending.';

  @override
  String get categoriesEmptyAction => 'Add category';

  @override
  String get categoriesArchiveTitle => 'Archive category?';

  @override
  String categoriesArchiveConfirm(String name) {
    return 'Archive \"$name\"? Existing expenses keep this category.';
  }

  @override
  String get categoriesFormNew => 'New category';

  @override
  String get categoriesFormEdit => 'Edit category';

  @override
  String get categoriesFormName => 'Name';

  @override
  String get categoriesFormNameRequired => 'Name is required';

  @override
  String get categoriesFormColor => 'Color';

  @override
  String get overviewTitle => 'This month';

  @override
  String get overviewEmpty => 'No spending in this range yet.';

  @override
  String get overviewTotal => 'Total';

  @override
  String get overviewByCategory => 'By category';

  @override
  String get overviewBudgets => 'Budgets';

  @override
  String overviewBudgetAlert(int percent) {
    return 'Reached $percent% of this budget';
  }

  @override
  String get budgetsEmptyTitle => 'No budgets yet';

  @override
  String get budgetsEmptyHint => 'Set a total or per-category spending limit.';

  @override
  String get budgetsEmptyAction => 'Add budget';

  @override
  String get budgetsArchiveTitle => 'Archive budget?';

  @override
  String budgetsArchiveConfirm(String name) {
    return 'Archive \"$name\"?';
  }

  @override
  String get budgetsFormNew => 'New budget';

  @override
  String get budgetsFormEdit => 'Edit budget';

  @override
  String get budgetsFormName => 'Name';

  @override
  String get budgetsFormNameRequired => 'Name is required';

  @override
  String get budgetsFormScope => 'Scope';

  @override
  String get budgetsScopeTotal => 'Total spending';

  @override
  String get budgetsScopeCategory => 'Category';

  @override
  String get budgetsFormCategory => 'Category';

  @override
  String get budgetsFormCategoryRequired => 'Pick a category';

  @override
  String get budgetsFormAmount => 'Amount';

  @override
  String get budgetsFormAmountRequired => 'Enter an amount';

  @override
  String get budgetsFormAmountInvalid => 'Enter a valid amount (e.g. 12.50)';

  @override
  String get budgetsFormInterval => 'Repeats every';

  @override
  String get budgetsFormIntervalCount => 'Count';

  @override
  String get budgetsFormIntervalCountInvalid => 'Enter a whole number ≥ 1';

  @override
  String get budgetsFormIntervalUnit => 'Unit';

  @override
  String get budgetsIntervalUnitDay => 'Days';

  @override
  String get budgetsIntervalUnitWeek => 'Weeks';

  @override
  String get budgetsIntervalUnitMonth => 'Months';

  @override
  String budgetsIntervalEveryDays(int count) {
    return 'Every $count days';
  }

  @override
  String budgetsIntervalEveryWeeks(int count) {
    return 'Every $count weeks';
  }

  @override
  String budgetsIntervalEveryMonths(int count) {
    return 'Every $count months';
  }

  @override
  String get budgetsFormAnchorDate => 'Period start';

  @override
  String get budgetsFormAlertPercent => 'Alert at';

  @override
  String get budgetsFormAlertPercentInvalid => 'Enter a percent from 1 to 100';

  @override
  String budgetsAlertAt(int percent) {
    return 'Alert at $percent%';
  }

  @override
  String budgetAlertTitle(String name) {
    return 'Budget alert: $name';
  }

  @override
  String budgetAlertBody(int percent, String spent, String amount) {
    return '$percent% used ($spent / $amount)';
  }

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsTheme => 'Theme';

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsSignOut => 'Sign out';

  @override
  String get settingsEmailImport => 'Email import';

  @override
  String get settingsEmailImportSubtitle =>
      'Connect a mailbox and sender allowlist';

  @override
  String get emailImportTitle => 'Email import';

  @override
  String get emailImportWizardStepMailbox => 'Mailbox';

  @override
  String get emailImportWizardStepSenders => 'Senders';

  @override
  String get emailImportWizardNext => 'Next';

  @override
  String get emailImportWizardBack => 'Back';

  @override
  String get emailImportWizardDone => 'Done';

  @override
  String get emailImportSetupBlurb =>
      'Connect a mailbox, then allow sender domains or full addresses so we can sync and extract spending.';

  @override
  String get emailImportAddFixture => 'Add demo mailbox';

  @override
  String get emailImportConnectGmail => 'Connect Gmail';

  @override
  String get emailImportFixtureLabel => 'Demo mailbox';

  @override
  String get emailImportGmailLabel => 'Gmail';

  @override
  String get emailImportGmailConnected =>
      'Gmail connected. Sync to import messages.';

  @override
  String emailImportGmailFailed(String detail) {
    return 'Gmail connection failed: $detail';
  }

  @override
  String get emailImportGmailFailedGeneric =>
      'Gmail connection failed. Try again.';

  @override
  String get emailImportGmailLaunchFailed => 'Could not open Google sign-in.';

  @override
  String get emailImportCancel => 'Cancel';

  @override
  String get emailImportSave => 'Save';

  @override
  String get emailImportNoMailbox =>
      'No mailbox yet. Add a demo mailbox or connect Gmail.';

  @override
  String get emailImportMailbox => 'Mailbox';

  @override
  String get emailImportRenameMailbox => 'Rename mailbox';

  @override
  String get emailImportRenameMailboxTitle => 'Rename mailbox';

  @override
  String get emailImportMailboxName => 'Name';

  @override
  String get emailImportDeleteMailbox => 'Delete mailbox';

  @override
  String get emailImportDeleteMailboxTitle => 'Delete mailbox?';

  @override
  String emailImportDeleteMailboxConfirm(String label) {
    return 'Remove \"$label\"? Synced messages, filters, and templates for this mailbox will be deleted.';
  }

  @override
  String get emailImportDomainFilters => 'Sender allowlist';

  @override
  String get emailImportDomainFiltersHint =>
      'One pattern per line. Domain (all senders): amazon.com. Exact sender: noreply@uber.com';

  @override
  String get emailImportNoFilters =>
      'Add at least one sender domain or email address before syncing';

  @override
  String get emailImportFiltersRequired =>
      'Add at least one sender allowlist pattern before syncing';

  @override
  String get emailImportTriggerSync => 'Sync now';

  @override
  String get emailImportSyncFrom => 'From';

  @override
  String get emailImportSyncTo => 'To';

  @override
  String get emailImportSyncClearDate => 'Clear';

  @override
  String get emailImportSyncQueued => 'Sync started…';

  @override
  String emailImportSyncProgress(int percent) {
    return 'Syncing… $percent%';
  }

  @override
  String get emailImportSyncProgressIndeterminate => 'Syncing…';

  @override
  String emailImportSyncSpendingsFound(int count) {
    return '$count spendings found';
  }

  @override
  String get emailImportSyncCompleteNothingToReview =>
      'Sync complete — nothing to review.';

  @override
  String emailImportSyncCompleteReview(int count) {
    return '$count items ready to review';
  }

  @override
  String get emailImportSyncOpenReview => 'Review';

  @override
  String get emailImportMessages => 'Recent messages';

  @override
  String get emailImportNoMessages => 'No messages yet. Sync after connecting.';

  @override
  String get emailImportApproveEmail => 'Approve';

  @override
  String get emailImportRejectEmail => 'Ignore';

  @override
  String get emailImportGeneratingTemplate =>
      'Generating template… This can take a moment.';

  @override
  String get emailImportApproveTemplateGenerated =>
      'Approved. Matching emails will appear under Review as spending candidates.';

  @override
  String get emailImportRejectTemplateGenerated =>
      'Ignored. Matching emails will be skipped.';

  @override
  String get emailImportGenerateTemplate => 'Generate template with AI';

  @override
  String emailImportTemplateGeneratedWithReeval(int count) {
    return 'Template generated; updated $count review items.';
  }

  @override
  String get emailImportTemplateGenerationFailed =>
      'Template generation failed. Please try again.';

  @override
  String get emailImportNoTemplates =>
      'No templates yet. Approve or ignore a sample message on the Setup tab.';

  @override
  String get emailImportEditTemplate => 'Edit template';

  @override
  String get emailImportTemplateName => 'Name';

  @override
  String get emailImportTemplateKindApprove => 'Approve';

  @override
  String get emailImportTemplateKindReject => 'Ignore';

  @override
  String get emailImportMatchFrom => 'Match from pattern';

  @override
  String get emailImportMatchSubject => 'Match subject regex (optional)';

  @override
  String get emailImportExtractorsJson => 'Extractors JSON';

  @override
  String get emailImportNoPending =>
      'No pending spending candidates. Sync your mailbox to import spending emails.';

  @override
  String get emailImportAcceptTitle => 'Accept as expense';

  @override
  String get emailImportCategory => 'Category';

  @override
  String get emailImportAccept => 'Accept';

  @override
  String get emailImportReject => 'Reject';

  @override
  String get emailImportRejectAll => 'Reject all';

  @override
  String get emailImportRejectAllTitle => 'Reject all pending?';

  @override
  String emailImportRejectAllConfirm(int count) {
    return 'Reject $count pending spending candidates? This cannot be undone.';
  }

  @override
  String emailImportRejectAllDone(int count) {
    return 'Rejected $count candidates.';
  }

  @override
  String get emailImportClearInbox => 'Clear inbox data';

  @override
  String get emailImportClearInboxTitle => 'Clear inbox data?';

  @override
  String get emailImportClearInboxConfirm =>
      'Remove synced messages, review items, and sync history for this mailbox? Filters and templates stay. The next sync can re-fetch emails.';

  @override
  String get emailImportClearInboxDone => 'Inbox data cleared.';

  @override
  String get emailImportNeedCategory =>
      'Create a category before accepting expenses.';

  @override
  String get emailImportViewEmail => 'View email';

  @override
  String get emailImportPagePrevious => 'Previous';

  @override
  String get emailImportPageNext => 'Next';

  @override
  String emailImportPageOf(int page, int totalPages) {
    return 'Page $page of $totalPages';
  }

  @override
  String get sourceEmailTitle => 'Source email';

  @override
  String get sourceEmailBodyMissing =>
      'No email body was stored for this message.';

  @override
  String get sourceEmailNotFound =>
      'No source email is linked to this expense.';

  @override
  String get sourceEmailLoadFailed => 'Could not load the source email.';
}

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
  String get authAuthorisationUrlMissing => 'Authorisation URL missing from response';

  @override
  String get authCouldNotGetAuthorisationUrl => 'Could not get authorisation URL';

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
  String get expensesEmptyTitle => 'No expenses yet';

  @override
  String get expensesEmptyHint => 'Tap + to log your first spend.';

  @override
  String get expensesEmptyAction => 'Add expense';

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
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageSystem => 'System';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageSpanish => 'Spanish';
}

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
}

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es')
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Spend Manager'**
  String get appTitle;

  /// No description provided for @navOverview.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get navOverview;

  /// No description provided for @navExpenses.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get navExpenses;

  /// No description provided for @navCategories.
  ///
  /// In en, this message translates to:
  /// **'Categories'**
  String get navCategories;

  /// No description provided for @navBudgets.
  ///
  /// In en, this message translates to:
  /// **'Budgets'**
  String get navBudgets;

  /// No description provided for @tooltipRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get tooltipRefresh;

  /// No description provided for @tooltipSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get tooltipSignOut;

  /// No description provided for @tooltipSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get tooltipSettings;

  /// No description provided for @tooltipAddExpense.
  ///
  /// In en, this message translates to:
  /// **'Add expense'**
  String get tooltipAddExpense;

  /// No description provided for @tooltipAddCategory.
  ///
  /// In en, this message translates to:
  /// **'Add category'**
  String get tooltipAddCategory;

  /// No description provided for @tooltipAddBudget.
  ///
  /// In en, this message translates to:
  /// **'Add budget'**
  String get tooltipAddBudget;

  /// No description provided for @loginCreateAccount.
  ///
  /// In en, this message translates to:
  /// **'Create an account'**
  String get loginCreateAccount;

  /// No description provided for @loginSignInContinue.
  ///
  /// In en, this message translates to:
  /// **'Sign in to continue'**
  String get loginSignInContinue;

  /// No description provided for @loginEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get loginEmail;

  /// No description provided for @loginEmailRequired.
  ///
  /// In en, this message translates to:
  /// **'Email is required'**
  String get loginEmailRequired;

  /// No description provided for @loginEmailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email'**
  String get loginEmailInvalid;

  /// No description provided for @loginPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get loginPassword;

  /// No description provided for @loginPasswordRequired.
  ///
  /// In en, this message translates to:
  /// **'Password is required'**
  String get loginPasswordRequired;

  /// No description provided for @loginPasswordTooShort.
  ///
  /// In en, this message translates to:
  /// **'Use at least 8 characters'**
  String get loginPasswordTooShort;

  /// No description provided for @loginShowPassword.
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get loginShowPassword;

  /// No description provided for @loginHidePassword.
  ///
  /// In en, this message translates to:
  /// **'Hide password'**
  String get loginHidePassword;

  /// No description provided for @loginRememberDevice.
  ///
  /// In en, this message translates to:
  /// **'Remember this device'**
  String get loginRememberDevice;

  /// No description provided for @loginSignUp.
  ///
  /// In en, this message translates to:
  /// **'Sign up'**
  String get loginSignUp;

  /// No description provided for @loginSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get loginSignIn;

  /// No description provided for @loginAlreadyHaveAccount.
  ///
  /// In en, this message translates to:
  /// **'Already have an account? Sign in'**
  String get loginAlreadyHaveAccount;

  /// No description provided for @loginNeedAccount.
  ///
  /// In en, this message translates to:
  /// **'Need an account? Sign up'**
  String get loginNeedAccount;

  /// No description provided for @loginOrContinueWith.
  ///
  /// In en, this message translates to:
  /// **'Or continue with'**
  String get loginOrContinueWith;

  /// No description provided for @providerGoogle.
  ///
  /// In en, this message translates to:
  /// **'Google'**
  String get providerGoogle;

  /// No description provided for @providerGitHub.
  ///
  /// In en, this message translates to:
  /// **'GitHub'**
  String get providerGitHub;

  /// No description provided for @providerApple.
  ///
  /// In en, this message translates to:
  /// **'Apple'**
  String get providerApple;

  /// No description provided for @providerTwitter.
  ///
  /// In en, this message translates to:
  /// **'Twitter'**
  String get providerTwitter;

  /// No description provided for @authActionSignUp.
  ///
  /// In en, this message translates to:
  /// **'Sign up'**
  String get authActionSignUp;

  /// No description provided for @authActionSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authActionSignIn;

  /// No description provided for @authActionOAuth.
  ///
  /// In en, this message translates to:
  /// **'OAuth sign in'**
  String get authActionOAuth;

  /// No description provided for @authFailedStatus.
  ///
  /// In en, this message translates to:
  /// **'{action} failed ({status})'**
  String authFailedStatus(String action, String status);

  /// No description provided for @authNoSessionToken.
  ///
  /// In en, this message translates to:
  /// **'{action} succeeded but no session token was returned'**
  String authNoSessionToken(String action);

  /// No description provided for @authStartOAuthFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to start {provider} login ({statusCode})'**
  String authStartOAuthFailed(String provider, int statusCode);

  /// No description provided for @authAuthorisationUrlMissing.
  ///
  /// In en, this message translates to:
  /// **'Authorisation URL missing from response'**
  String get authAuthorisationUrlMissing;

  /// No description provided for @authCouldNotGetAuthorisationUrl.
  ///
  /// In en, this message translates to:
  /// **'Could not get authorisation URL'**
  String get authCouldNotGetAuthorisationUrl;

  /// No description provided for @authCouldNotOpenLogin.
  ///
  /// In en, this message translates to:
  /// **'Could not open {provider} login'**
  String authCouldNotOpenLogin(String provider);

  /// No description provided for @errorNotSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Not signed in'**
  String get errorNotSignedIn;

  /// No description provided for @errorSessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Session expired. Please sign in again.'**
  String get errorSessionExpired;

  /// No description provided for @errorRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Request failed ({statusCode}): {body}'**
  String errorRequestFailed(int statusCode, String body);

  /// No description provided for @errorNoGraphQlData.
  ///
  /// In en, this message translates to:
  /// **'No data in GraphQL response'**
  String get errorNoGraphQlData;

  /// No description provided for @errorUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown error'**
  String get errorUnknown;

  /// No description provided for @errorCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'Could not load data'**
  String get errorCouldNotLoad;

  /// No description provided for @errorRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get errorRetry;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @archive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get archive;

  /// No description provided for @expensesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No expenses yet'**
  String get expensesEmptyTitle;

  /// No description provided for @expensesEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Tap + to log your first spend.'**
  String get expensesEmptyHint;

  /// No description provided for @expensesEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add expense'**
  String get expensesEmptyAction;

  /// No description provided for @expensesDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete expense?'**
  String get expensesDeleteTitle;

  /// No description provided for @expensesDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove this expense?'**
  String get expensesDeleteConfirm;

  /// No description provided for @expensesFormNew.
  ///
  /// In en, this message translates to:
  /// **'New expense'**
  String get expensesFormNew;

  /// No description provided for @expensesFormEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit expense'**
  String get expensesFormEdit;

  /// No description provided for @expensesFormAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get expensesFormAmount;

  /// No description provided for @expensesFormAmountRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount'**
  String get expensesFormAmountRequired;

  /// No description provided for @expensesFormAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid amount (e.g. 12.50)'**
  String get expensesFormAmountInvalid;

  /// No description provided for @expensesFormCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get expensesFormCategory;

  /// No description provided for @expensesFormCategoryRequired.
  ///
  /// In en, this message translates to:
  /// **'Pick a category'**
  String get expensesFormCategoryRequired;

  /// No description provided for @expensesFormDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get expensesFormDate;

  /// No description provided for @expensesFormNote.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get expensesFormNote;

  /// No description provided for @expensesFormCurrency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get expensesFormCurrency;

  /// No description provided for @categoriesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No categories yet'**
  String get categoriesEmptyTitle;

  /// No description provided for @categoriesEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Create categories to organize spending.'**
  String get categoriesEmptyHint;

  /// No description provided for @categoriesEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add category'**
  String get categoriesEmptyAction;

  /// No description provided for @categoriesArchiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive category?'**
  String get categoriesArchiveTitle;

  /// No description provided for @categoriesArchiveConfirm.
  ///
  /// In en, this message translates to:
  /// **'Archive \"{name}\"? Existing expenses keep this category.'**
  String categoriesArchiveConfirm(String name);

  /// No description provided for @categoriesFormNew.
  ///
  /// In en, this message translates to:
  /// **'New category'**
  String get categoriesFormNew;

  /// No description provided for @categoriesFormEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit category'**
  String get categoriesFormEdit;

  /// No description provided for @categoriesFormName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get categoriesFormName;

  /// No description provided for @categoriesFormNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Name is required'**
  String get categoriesFormNameRequired;

  /// No description provided for @categoriesFormColor.
  ///
  /// In en, this message translates to:
  /// **'Color'**
  String get categoriesFormColor;

  /// No description provided for @overviewTitle.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get overviewTitle;

  /// No description provided for @overviewEmpty.
  ///
  /// In en, this message translates to:
  /// **'No spending in this range yet.'**
  String get overviewEmpty;

  /// No description provided for @overviewTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get overviewTotal;

  /// No description provided for @overviewByCategory.
  ///
  /// In en, this message translates to:
  /// **'By category'**
  String get overviewByCategory;

  /// No description provided for @overviewBudgets.
  ///
  /// In en, this message translates to:
  /// **'Budgets'**
  String get overviewBudgets;

  /// No description provided for @overviewBudgetAlert.
  ///
  /// In en, this message translates to:
  /// **'Reached {percent}% of this budget'**
  String overviewBudgetAlert(int percent);

  /// No description provided for @budgetsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No budgets yet'**
  String get budgetsEmptyTitle;

  /// No description provided for @budgetsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Set a total or per-category spending limit.'**
  String get budgetsEmptyHint;

  /// No description provided for @budgetsEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add budget'**
  String get budgetsEmptyAction;

  /// No description provided for @budgetsArchiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive budget?'**
  String get budgetsArchiveTitle;

  /// No description provided for @budgetsArchiveConfirm.
  ///
  /// In en, this message translates to:
  /// **'Archive \"{name}\"?'**
  String budgetsArchiveConfirm(String name);

  /// No description provided for @budgetsFormNew.
  ///
  /// In en, this message translates to:
  /// **'New budget'**
  String get budgetsFormNew;

  /// No description provided for @budgetsFormEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit budget'**
  String get budgetsFormEdit;

  /// No description provided for @budgetsFormName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get budgetsFormName;

  /// No description provided for @budgetsFormNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Name is required'**
  String get budgetsFormNameRequired;

  /// No description provided for @budgetsFormScope.
  ///
  /// In en, this message translates to:
  /// **'Scope'**
  String get budgetsFormScope;

  /// No description provided for @budgetsScopeTotal.
  ///
  /// In en, this message translates to:
  /// **'Total spending'**
  String get budgetsScopeTotal;

  /// No description provided for @budgetsScopeCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get budgetsScopeCategory;

  /// No description provided for @budgetsFormCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get budgetsFormCategory;

  /// No description provided for @budgetsFormCategoryRequired.
  ///
  /// In en, this message translates to:
  /// **'Pick a category'**
  String get budgetsFormCategoryRequired;

  /// No description provided for @budgetsFormAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get budgetsFormAmount;

  /// No description provided for @budgetsFormAmountRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount'**
  String get budgetsFormAmountRequired;

  /// No description provided for @budgetsFormAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid amount (e.g. 12.50)'**
  String get budgetsFormAmountInvalid;

  /// No description provided for @budgetsFormInterval.
  ///
  /// In en, this message translates to:
  /// **'Repeats every'**
  String get budgetsFormInterval;

  /// No description provided for @budgetsFormIntervalCount.
  ///
  /// In en, this message translates to:
  /// **'Count'**
  String get budgetsFormIntervalCount;

  /// No description provided for @budgetsFormIntervalCountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number ≥ 1'**
  String get budgetsFormIntervalCountInvalid;

  /// No description provided for @budgetsFormIntervalUnit.
  ///
  /// In en, this message translates to:
  /// **'Unit'**
  String get budgetsFormIntervalUnit;

  /// No description provided for @budgetsIntervalUnitDay.
  ///
  /// In en, this message translates to:
  /// **'Days'**
  String get budgetsIntervalUnitDay;

  /// No description provided for @budgetsIntervalUnitWeek.
  ///
  /// In en, this message translates to:
  /// **'Weeks'**
  String get budgetsIntervalUnitWeek;

  /// No description provided for @budgetsIntervalUnitMonth.
  ///
  /// In en, this message translates to:
  /// **'Months'**
  String get budgetsIntervalUnitMonth;

  /// No description provided for @budgetsIntervalEveryDays.
  ///
  /// In en, this message translates to:
  /// **'Every {count} days'**
  String budgetsIntervalEveryDays(int count);

  /// No description provided for @budgetsIntervalEveryWeeks.
  ///
  /// In en, this message translates to:
  /// **'Every {count} weeks'**
  String budgetsIntervalEveryWeeks(int count);

  /// No description provided for @budgetsIntervalEveryMonths.
  ///
  /// In en, this message translates to:
  /// **'Every {count} months'**
  String budgetsIntervalEveryMonths(int count);

  /// No description provided for @budgetsFormAnchorDate.
  ///
  /// In en, this message translates to:
  /// **'Period start'**
  String get budgetsFormAnchorDate;

  /// No description provided for @budgetsFormAlertPercent.
  ///
  /// In en, this message translates to:
  /// **'Alert at'**
  String get budgetsFormAlertPercent;

  /// No description provided for @budgetsFormAlertPercentInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a percent from 1 to 100'**
  String get budgetsFormAlertPercentInvalid;

  /// No description provided for @budgetsAlertAt.
  ///
  /// In en, this message translates to:
  /// **'Alert at {percent}%'**
  String budgetsAlertAt(int percent);

  /// No description provided for @budgetAlertTitle.
  ///
  /// In en, this message translates to:
  /// **'Budget alert: {name}'**
  String budgetAlertTitle(String name);

  /// No description provided for @budgetAlertBody.
  ///
  /// In en, this message translates to:
  /// **'{percent}% used ({spent} / {amount})'**
  String budgetAlertBody(int percent, String spent, String amount);

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsTheme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsTheme;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get settingsSignOut;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {


  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en': return AppLocalizationsEn();
    case 'es': return AppLocalizationsEs();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}

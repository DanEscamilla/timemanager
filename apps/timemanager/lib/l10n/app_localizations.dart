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
  /// **'Time Manager'**
  String get appTitle;

  /// No description provided for @navActivities.
  ///
  /// In en, this message translates to:
  /// **'Activities'**
  String get navActivities;

  /// No description provided for @navCalendar.
  ///
  /// In en, this message translates to:
  /// **'Calendar'**
  String get navCalendar;

  /// No description provided for @navOverview.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get navOverview;

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

  /// No description provided for @tooltipAddActivity.
  ///
  /// In en, this message translates to:
  /// **'Add activity'**
  String get tooltipAddActivity;

  /// No description provided for @tooltipAddActivityForDay.
  ///
  /// In en, this message translates to:
  /// **'Add activity for this day'**
  String get tooltipAddActivityForDay;

  /// No description provided for @tooltipSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get tooltipSettings;

  /// No description provided for @tooltipGroups.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get tooltipGroups;

  /// No description provided for @tooltipAddGroup.
  ///
  /// In en, this message translates to:
  /// **'Add group'**
  String get tooltipAddGroup;

  /// No description provided for @groupsTitle.
  ///
  /// In en, this message translates to:
  /// **'Groups'**
  String get groupsTitle;

  /// No description provided for @groupsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No groups yet'**
  String get groupsEmptyTitle;

  /// No description provided for @groupsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Create a group to organize your activities by color.'**
  String get groupsEmptyHint;

  /// No description provided for @groupsEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add group'**
  String get groupsEmptyAction;

  /// No description provided for @groupsDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete group?'**
  String get groupsDeleteTitle;

  /// No description provided for @groupsDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove \"{name}\"? Activities in this group will be ungrouped.'**
  String groupsDeleteConfirm(String name);

  /// No description provided for @groupsDeleted.
  ///
  /// In en, this message translates to:
  /// **'Group deleted'**
  String get groupsDeleted;

  /// No description provided for @formEditGroup.
  ///
  /// In en, this message translates to:
  /// **'Edit group'**
  String get formEditGroup;

  /// No description provided for @formNewGroup.
  ///
  /// In en, this message translates to:
  /// **'New group'**
  String get formNewGroup;

  /// No description provided for @formGroupName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get formGroupName;

  /// No description provided for @formGroupNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Name is required'**
  String get formGroupNameRequired;

  /// No description provided for @formGroupColor.
  ///
  /// In en, this message translates to:
  /// **'Color'**
  String get formGroupColor;

  /// No description provided for @formGroup.
  ///
  /// In en, this message translates to:
  /// **'Group'**
  String get formGroup;

  /// No description provided for @formNoGroup.
  ///
  /// In en, this message translates to:
  /// **'No group'**
  String get formNoGroup;

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

  /// No description provided for @overviewGreeting.
  ///
  /// In en, this message translates to:
  /// **'Hello'**
  String get overviewGreeting;

  /// No description provided for @overviewTodayDate.
  ///
  /// In en, this message translates to:
  /// **'{date}'**
  String overviewTodayDate(String date);

  /// No description provided for @overviewStatToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get overviewStatToday;

  /// No description provided for @overviewStatWeek.
  ///
  /// In en, this message translates to:
  /// **'This week'**
  String get overviewStatWeek;

  /// No description provided for @overviewStatRecurring.
  ///
  /// In en, this message translates to:
  /// **'Recurring'**
  String get overviewStatRecurring;

  /// No description provided for @overviewTodaySchedule.
  ///
  /// In en, this message translates to:
  /// **'Today\'s schedule'**
  String get overviewTodaySchedule;

  /// No description provided for @overviewUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get overviewUpcoming;

  /// No description provided for @overviewQuickActions.
  ///
  /// In en, this message translates to:
  /// **'Quick actions'**
  String get overviewQuickActions;

  /// No description provided for @overviewAddActivity.
  ///
  /// In en, this message translates to:
  /// **'Add activity'**
  String get overviewAddActivity;

  /// No description provided for @overviewOpenCalendar.
  ///
  /// In en, this message translates to:
  /// **'Open calendar'**
  String get overviewOpenCalendar;

  /// No description provided for @overviewEmptyToday.
  ///
  /// In en, this message translates to:
  /// **'Nothing scheduled today'**
  String get overviewEmptyToday;

  /// No description provided for @overviewEmptyTodayHint.
  ///
  /// In en, this message translates to:
  /// **'Add an activity to fill your day.'**
  String get overviewEmptyTodayHint;

  /// No description provided for @overviewEmptyUpcoming.
  ///
  /// In en, this message translates to:
  /// **'No upcoming activities'**
  String get overviewEmptyUpcoming;

  /// No description provided for @overviewViewAll.
  ///
  /// In en, this message translates to:
  /// **'View all activities'**
  String get overviewViewAll;

  /// No description provided for @calendarEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'No events in this range. Tap + to add one.'**
  String get calendarEmptyHint;

  /// No description provided for @activitiesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No activities yet'**
  String get activitiesEmptyTitle;

  /// No description provided for @activitiesEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Tap + to add your first activity.'**
  String get activitiesEmptyHint;

  /// No description provided for @activitiesEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add activity'**
  String get activitiesEmptyAction;

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

  /// No description provided for @errorCouldNotLoadActivities.
  ///
  /// In en, this message translates to:
  /// **'Could not load activities'**
  String get errorCouldNotLoadActivities;

  /// No description provided for @errorRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get errorRetry;

  /// No description provided for @activitiesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No activities yet.\nTap + to add one.'**
  String get activitiesEmpty;

  /// No description provided for @activitiesDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete activity?'**
  String get activitiesDeleteTitle;

  /// No description provided for @activitiesDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove \"{title}\"?'**
  String activitiesDeleteConfirm(String title);

  /// No description provided for @activitiesCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get activitiesCancel;

  /// No description provided for @activitiesDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get activitiesDelete;

  /// No description provided for @activitiesDeleted.
  ///
  /// In en, this message translates to:
  /// **'Activity deleted'**
  String get activitiesDeleted;

  /// No description provided for @activitiesEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get activitiesEdit;

  /// No description provided for @activitiesRecurring.
  ///
  /// In en, this message translates to:
  /// **'Recurring'**
  String get activitiesRecurring;

  /// No description provided for @calendarDay.
  ///
  /// In en, this message translates to:
  /// **'Day'**
  String get calendarDay;

  /// No description provided for @calendarWeek.
  ///
  /// In en, this message translates to:
  /// **'Week'**
  String get calendarWeek;

  /// No description provided for @calendarMonth.
  ///
  /// In en, this message translates to:
  /// **'Month'**
  String get calendarMonth;

  /// No description provided for @formEditActivity.
  ///
  /// In en, this message translates to:
  /// **'Edit activity'**
  String get formEditActivity;

  /// No description provided for @formNewActivity.
  ///
  /// In en, this message translates to:
  /// **'New activity'**
  String get formNewActivity;

  /// No description provided for @formTitle.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get formTitle;

  /// No description provided for @formTitleRequired.
  ///
  /// In en, this message translates to:
  /// **'Title is required'**
  String get formTitleRequired;

  /// No description provided for @formDescriptionOptional.
  ///
  /// In en, this message translates to:
  /// **'Description (optional)'**
  String get formDescriptionOptional;

  /// No description provided for @formStart.
  ///
  /// In en, this message translates to:
  /// **'Start'**
  String get formStart;

  /// No description provided for @formEnd.
  ///
  /// In en, this message translates to:
  /// **'End'**
  String get formEnd;

  /// No description provided for @formRecurring.
  ///
  /// In en, this message translates to:
  /// **'Recurring'**
  String get formRecurring;

  /// No description provided for @formOneTime.
  ///
  /// In en, this message translates to:
  /// **'One-time'**
  String get formOneTime;

  /// No description provided for @formRepeatsOnSchedule.
  ///
  /// In en, this message translates to:
  /// **'Repeats on a schedule'**
  String get formRepeatsOnSchedule;

  /// No description provided for @formHappensOnSingleDate.
  ///
  /// In en, this message translates to:
  /// **'Happens on a single date'**
  String get formHappensOnSingleDate;

  /// No description provided for @formDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get formDate;

  /// No description provided for @formSelectDate.
  ///
  /// In en, this message translates to:
  /// **'Select date'**
  String get formSelectDate;

  /// No description provided for @formRepeats.
  ///
  /// In en, this message translates to:
  /// **'Repeats'**
  String get formRepeats;

  /// No description provided for @formStarts.
  ///
  /// In en, this message translates to:
  /// **'Starts'**
  String get formStarts;

  /// No description provided for @formSelectStartDate.
  ///
  /// In en, this message translates to:
  /// **'Select start date'**
  String get formSelectStartDate;

  /// No description provided for @formEndsOptional.
  ///
  /// In en, this message translates to:
  /// **'Ends (optional)'**
  String get formEndsOptional;

  /// No description provided for @formNoEndDate.
  ///
  /// In en, this message translates to:
  /// **'No end date'**
  String get formNoEndDate;

  /// No description provided for @formClearEndDate.
  ///
  /// In en, this message translates to:
  /// **'Clear end date'**
  String get formClearEndDate;

  /// No description provided for @formDaysOfWeek.
  ///
  /// In en, this message translates to:
  /// **'Days of week'**
  String get formDaysOfWeek;

  /// No description provided for @formDaysOfMonth.
  ///
  /// In en, this message translates to:
  /// **'Days of month'**
  String get formDaysOfMonth;

  /// No description provided for @formLastDayOfMonth.
  ///
  /// In en, this message translates to:
  /// **'Last day of month'**
  String get formLastDayOfMonth;

  /// No description provided for @formRepeatEveryNDays.
  ///
  /// In en, this message translates to:
  /// **'Repeat every N days'**
  String get formRepeatEveryNDays;

  /// No description provided for @formIntervalAtLeastOne.
  ///
  /// In en, this message translates to:
  /// **'Enter an integer of at least 1'**
  String get formIntervalAtLeastOne;

  /// No description provided for @formSaveChanges.
  ///
  /// In en, this message translates to:
  /// **'Save changes'**
  String get formSaveChanges;

  /// No description provided for @formCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get formCreate;

  /// No description provided for @formEndTimeAfterStart.
  ///
  /// In en, this message translates to:
  /// **'End time must be after start time'**
  String get formEndTimeAfterStart;

  /// No description provided for @formDateRequired.
  ///
  /// In en, this message translates to:
  /// **'Date is required for one-time activities'**
  String get formDateRequired;

  /// No description provided for @formRecurrenceStartRequired.
  ///
  /// In en, this message translates to:
  /// **'Recurrence start date is required'**
  String get formRecurrenceStartRequired;

  /// No description provided for @formEndDateAfterStart.
  ///
  /// In en, this message translates to:
  /// **'End date must be on or after start date'**
  String get formEndDateAfterStart;

  /// No description provided for @formSelectWeekday.
  ///
  /// In en, this message translates to:
  /// **'Select at least one day of the week'**
  String get formSelectWeekday;

  /// No description provided for @formSelectMonthDay.
  ///
  /// In en, this message translates to:
  /// **'Select at least one day of the month, or last day'**
  String get formSelectMonthDay;

  /// No description provided for @formIntervalInvalid.
  ///
  /// In en, this message translates to:
  /// **'Interval must be an integer of at least 1'**
  String get formIntervalInvalid;

  /// No description provided for @weekdaySun.
  ///
  /// In en, this message translates to:
  /// **'Sun'**
  String get weekdaySun;

  /// No description provided for @weekdayMon.
  ///
  /// In en, this message translates to:
  /// **'Mon'**
  String get weekdayMon;

  /// No description provided for @weekdayTue.
  ///
  /// In en, this message translates to:
  /// **'Tue'**
  String get weekdayTue;

  /// No description provided for @weekdayWed.
  ///
  /// In en, this message translates to:
  /// **'Wed'**
  String get weekdayWed;

  /// No description provided for @weekdayThu.
  ///
  /// In en, this message translates to:
  /// **'Thu'**
  String get weekdayThu;

  /// No description provided for @weekdayFri.
  ///
  /// In en, this message translates to:
  /// **'Fri'**
  String get weekdayFri;

  /// No description provided for @weekdaySat.
  ///
  /// In en, this message translates to:
  /// **'Sat'**
  String get weekdaySat;

  /// No description provided for @recurrenceWeekly.
  ///
  /// In en, this message translates to:
  /// **'Weekly'**
  String get recurrenceWeekly;

  /// No description provided for @recurrenceMonthly.
  ///
  /// In en, this message translates to:
  /// **'Monthly'**
  String get recurrenceMonthly;

  /// No description provided for @recurrenceEveryXDays.
  ///
  /// In en, this message translates to:
  /// **'Every X days'**
  String get recurrenceEveryXDays;

  /// No description provided for @recurrenceWeeklyWithDays.
  ///
  /// In en, this message translates to:
  /// **'Weekly · {days}'**
  String recurrenceWeeklyWithDays(String days);

  /// No description provided for @recurrenceMonthlyWithParts.
  ///
  /// In en, this message translates to:
  /// **'Monthly · {parts}'**
  String recurrenceMonthlyWithParts(String parts);

  /// No description provided for @recurrenceLastDay.
  ///
  /// In en, this message translates to:
  /// **'last day'**
  String get recurrenceLastDay;

  /// No description provided for @recurrenceEveryDay.
  ///
  /// In en, this message translates to:
  /// **'Every day'**
  String get recurrenceEveryDay;

  /// No description provided for @recurrenceEveryNDays.
  ///
  /// In en, this message translates to:
  /// **'Every {count} days'**
  String recurrenceEveryNDays(int count);

  /// No description provided for @scheduleTimeRange.
  ///
  /// In en, this message translates to:
  /// **'{start} – {end}'**
  String scheduleTimeRange(String start, String end);

  /// No description provided for @scheduleDateTimeRange.
  ///
  /// In en, this message translates to:
  /// **'{date} · {start} – {end}'**
  String scheduleDateTimeRange(String date, String start, String end);

  /// No description provided for @scheduleSummaryTimeRange.
  ///
  /// In en, this message translates to:
  /// **'{summary} · {start} – {end}'**
  String scheduleSummaryTimeRange(String summary, String start, String end);
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

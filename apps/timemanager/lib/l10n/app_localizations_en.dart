// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Time Manager';

  @override
  String get navActivities => 'Activities';

  @override
  String get navCalendar => 'Calendar';

  @override
  String get navOverview => 'Overview';

  @override
  String get tooltipRefresh => 'Refresh';

  @override
  String get tooltipSignOut => 'Sign out';

  @override
  String get tooltipAddActivity => 'Add activity';

  @override
  String get tooltipAddActivityForDay => 'Add activity for this day';

  @override
  String get tooltipSettings => 'Settings';

  @override
  String get tooltipGroups => 'Groups';

  @override
  String get tooltipAddGroup => 'Add group';

  @override
  String get groupsTitle => 'Groups';

  @override
  String get groupsEmptyTitle => 'No groups yet';

  @override
  String get groupsEmptyHint => 'Create a group to organize your activities by color.';

  @override
  String get groupsEmptyAction => 'Add group';

  @override
  String get groupsDeleteTitle => 'Delete group?';

  @override
  String groupsDeleteConfirm(String name) {
    return 'Remove \"$name\"? Activities in this group will be ungrouped.';
  }

  @override
  String get groupsDeleted => 'Group deleted';

  @override
  String get formEditGroup => 'Edit group';

  @override
  String get formNewGroup => 'New group';

  @override
  String get formGroupName => 'Name';

  @override
  String get formGroupNameRequired => 'Name is required';

  @override
  String get formGroupColor => 'Color';

  @override
  String get formGroup => 'Group';

  @override
  String get formNoGroup => 'No group';

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
  String get overviewGreeting => 'Hello';

  @override
  String overviewTodayDate(String date) {
    return '$date';
  }

  @override
  String get overviewStatToday => 'Today';

  @override
  String get overviewStatWeek => 'This week';

  @override
  String get overviewStatRecurring => 'Recurring';

  @override
  String get overviewTodaySchedule => 'Today\'s schedule';

  @override
  String get overviewUpcoming => 'Upcoming';

  @override
  String get overviewQuickActions => 'Quick actions';

  @override
  String get overviewAddActivity => 'Add activity';

  @override
  String get overviewOpenCalendar => 'Open calendar';

  @override
  String get overviewEmptyToday => 'Nothing scheduled today';

  @override
  String get overviewEmptyTodayHint => 'Add an activity to fill your day.';

  @override
  String get overviewEmptyUpcoming => 'No upcoming activities';

  @override
  String get overviewViewAll => 'View all activities';

  @override
  String get calendarEmptyHint => 'No events in this range. Tap + to add one.';

  @override
  String get activitiesEmptyTitle => 'No activities yet';

  @override
  String get activitiesEmptyHint => 'Tap + to add your first activity.';

  @override
  String get activitiesEmptyAction => 'Add activity';

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
  String get errorCouldNotLoadActivities => 'Could not load activities';

  @override
  String get errorRetry => 'Retry';

  @override
  String get activitiesEmpty => 'No activities yet.\nTap + to add one.';

  @override
  String get activitiesDeleteTitle => 'Delete activity?';

  @override
  String activitiesDeleteConfirm(String title) {
    return 'Remove \"$title\"?';
  }

  @override
  String get activitiesCancel => 'Cancel';

  @override
  String get activitiesDelete => 'Delete';

  @override
  String get activitiesDeleted => 'Activity deleted';

  @override
  String get activitiesEdit => 'Edit';

  @override
  String get activitiesRecurring => 'Recurring';

  @override
  String get calendarDay => 'Day';

  @override
  String get calendarWeek => 'Week';

  @override
  String get calendarMonth => 'Month';

  @override
  String get formEditActivity => 'Edit activity';

  @override
  String get formNewActivity => 'New activity';

  @override
  String get formTitle => 'Title';

  @override
  String get formTitleRequired => 'Title is required';

  @override
  String get formDescriptionOptional => 'Description (optional)';

  @override
  String get formStart => 'Start';

  @override
  String get formEnd => 'End';

  @override
  String get formRecurring => 'Recurring';

  @override
  String get formOneTime => 'One-time';

  @override
  String get formRepeatsOnSchedule => 'Repeats on a schedule';

  @override
  String get formHappensOnSingleDate => 'Happens on a single date';

  @override
  String get formDate => 'Date';

  @override
  String get formSelectDate => 'Select date';

  @override
  String get formRepeats => 'Repeats';

  @override
  String get formStarts => 'Starts';

  @override
  String get formSelectStartDate => 'Select start date';

  @override
  String get formEndsOptional => 'Ends (optional)';

  @override
  String get formNoEndDate => 'No end date';

  @override
  String get formClearEndDate => 'Clear end date';

  @override
  String get formDaysOfWeek => 'Days of week';

  @override
  String get formDaysOfMonth => 'Days of month';

  @override
  String get formLastDayOfMonth => 'Last day of month';

  @override
  String get formRepeatEveryNDays => 'Repeat every N days';

  @override
  String get formIntervalAtLeastOne => 'Enter an integer of at least 1';

  @override
  String get formSaveChanges => 'Save changes';

  @override
  String get formCreate => 'Create';

  @override
  String get formEndTimeAfterStart => 'End time must be after start time';

  @override
  String get formDateRequired => 'Date is required for one-time activities';

  @override
  String get formRecurrenceStartRequired => 'Recurrence start date is required';

  @override
  String get formEndDateAfterStart => 'End date must be on or after start date';

  @override
  String get formSelectWeekday => 'Select at least one day of the week';

  @override
  String get formSelectMonthDay => 'Select at least one day of the month, or last day';

  @override
  String get formIntervalInvalid => 'Interval must be an integer of at least 1';

  @override
  String get weekdaySun => 'Sun';

  @override
  String get weekdayMon => 'Mon';

  @override
  String get weekdayTue => 'Tue';

  @override
  String get weekdayWed => 'Wed';

  @override
  String get weekdayThu => 'Thu';

  @override
  String get weekdayFri => 'Fri';

  @override
  String get weekdaySat => 'Sat';

  @override
  String get recurrenceWeekly => 'Weekly';

  @override
  String get recurrenceMonthly => 'Monthly';

  @override
  String get recurrenceEveryXDays => 'Every X days';

  @override
  String recurrenceWeeklyWithDays(String days) {
    return 'Weekly · $days';
  }

  @override
  String recurrenceMonthlyWithParts(String parts) {
    return 'Monthly · $parts';
  }

  @override
  String get recurrenceLastDay => 'last day';

  @override
  String get recurrenceEveryDay => 'Every day';

  @override
  String recurrenceEveryNDays(int count) {
    return 'Every $count days';
  }

  @override
  String scheduleTimeRange(String start, String end) {
    return '$start – $end';
  }

  @override
  String scheduleDateTimeRange(String date, String start, String end) {
    return '$date · $start – $end';
  }

  @override
  String scheduleSummaryTimeRange(String summary, String start, String end) {
    return '$summary · $start – $end';
  }
}

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
  String get navGoals => 'Goals';

  @override
  String get navRewards => 'Rewards';

  @override
  String get tooltipRefresh => 'Refresh';

  @override
  String get tooltipSignOut => 'Sign out';

  @override
  String get tooltipAddActivity => 'Add activity';

  @override
  String get tooltipAddActivityForDay => 'Add activity for this day';

  @override
  String get tooltipAddGoal => 'Add goal';

  @override
  String get tooltipAddReward => 'Add reward';

  @override
  String get tooltipSettings => 'Settings';

  @override
  String get tooltipGroups => 'Groups';

  @override
  String get tooltipAddGroup => 'Add group';

  @override
  String get goalsEmptyTitle => 'No goals yet';

  @override
  String get goalsEmptyHint => 'Create a goal to track completions and time toward a target.';

  @override
  String get goalsEmptyAction => 'Add goal';

  @override
  String get goalsFilterActive => 'Active';

  @override
  String get goalsFilterScheduled => 'Scheduled';

  @override
  String get goalsFilterPaused => 'Paused';

  @override
  String get goalsFilterCompleted => 'Done';

  @override
  String get goalsFilterArchived => 'Archived';

  @override
  String get goalsFilterAll => 'All';

  @override
  String get goalsStartsAtScheduled => 'Scheduled';

  @override
  String goalsStartsInDays(int days) {
    return 'Starts in $days days';
  }

  @override
  String get goalsStartsTomorrow => 'Starts tomorrow';

  @override
  String get goalsStartsToday => 'Starts today';

  @override
  String get goalsFormStartsAt => 'Start date';

  @override
  String get goalsFormStartsAtCustom => 'Set a start date';

  @override
  String get goalsFormStartsAtHint => 'Leave off to start immediately when created.';

  @override
  String get goalsStartsAtConfirmTitle => 'Move start later?';

  @override
  String get goalsStartsAtConfirmBody => 'Moving the start date later may remove progress already counted. Continue?';

  @override
  String get goalsStartsAtConfirmAction => 'Move start';

  @override
  String get goalsStartingSoon => 'Starting soon';

  @override
  String get goalsDetailTitle => 'Goal';

  @override
  String get goalsNotFound => 'Goal not found';

  @override
  String get goalsDeleteTitle => 'Delete goal?';

  @override
  String goalsDeleteConfirm(String title) {
    return 'Remove \"$title\" and its progress history?';
  }

  @override
  String get goalsPause => 'Pause';

  @override
  String get goalsResume => 'Resume';

  @override
  String get goalsArchive => 'Archive';

  @override
  String goalsProgressPercent(int percent) {
    return '$percent%';
  }

  @override
  String goalsRemainingCount(int count) {
    return '$count left';
  }

  @override
  String goalsRemainingMinutes(int minutes) {
    return '$minutes min left';
  }

  @override
  String get goalsDeadlineApproaching => 'Deadline soon';

  @override
  String get goalsDeadlineOverdue => 'Overdue';

  @override
  String get goalsDeadlineFailed => 'Failed';

  @override
  String get goalsRuleActivityCount => 'Complete an activity N times';

  @override
  String get goalsRuleActivityDuration => 'Time on an activity';

  @override
  String get goalsRuleGroupDuration => 'Time on a group';

  @override
  String get goalsRuleGroupCount => 'Complete group activities N times';

  @override
  String get goalsRuleGroupAnyCount => 'Complete any from a group N times';

  @override
  String get goalsRuleGroupAllComplete => 'Complete all activities in a group';

  @override
  String get goalsRuleMultiDuration => 'Time across selected activities';

  @override
  String get goalsRuleStreak => 'Consecutive-day streak';

  @override
  String get goalsRuleTimeOfDay => 'Complete before/after a time';

  @override
  String get goalsRuleComposite => 'Composite (child goals)';

  @override
  String get goalsFormNew => 'New goal';

  @override
  String get goalsFormEdit => 'Edit goal';

  @override
  String get goalsFormTitle => 'Title';

  @override
  String get goalsFormRuleType => 'Goal type';

  @override
  String get goalsFormTargetCount => 'Target count';

  @override
  String get goalsFormTargetMinutes => 'Target minutes';

  @override
  String get goalsFormTargetInvalid => 'Enter a positive number';

  @override
  String get goalsFormLinkedActivities => 'Linked activities';

  @override
  String get goalsFormLinkedGroups => 'Linked groups';

  @override
  String get goalsFormDependencies => 'Dependencies';

  @override
  String get goalsFormSelectActivity => 'Select at least one activity';

  @override
  String get goalsFormSelectGroup => 'Select at least one group';

  @override
  String get goalsFormSelectDependency => 'Select at least one dependency';

  @override
  String get goalsFormCompositeMode => 'Composite mode';

  @override
  String get goalsCompositeAll => 'All children';

  @override
  String get goalsCompositeAny => 'Any N children';

  @override
  String get goalsCompositeWeighted => 'Weighted average';

  @override
  String get goalsFormBlockUntilUnlocked => 'Block progress until dependencies met';

  @override
  String get goalsFormRecurrence => 'Recurrence';

  @override
  String get goalsFormRecurrencePeriod => 'Repeats';

  @override
  String get goalsFormOneTime => 'One-time';

  @override
  String get goalsFormInterval => 'Interval';

  @override
  String get goalsRecurrenceQuarterly => 'Quarterly';

  @override
  String get goalsFormDeadline => 'Deadline';

  @override
  String get goalsFormDeadlineKind => 'Deadline type';

  @override
  String get goalsFormNoDeadline => 'No deadline';

  @override
  String get goalsFormDeadlineAbsolute => 'Fixed date';

  @override
  String get goalsFormDeadlineRelative => 'Days after cycle starts';

  @override
  String get goalsFormDeadlineDays => 'Days after cycle start';

  @override
  String get goalsFormSaving => 'Saving…';

  @override
  String get goalsLinkedSources => 'Linked sources';

  @override
  String get goalsDanglingLink => 'Removed source';

  @override
  String get goalsDependencies => 'Dependencies';

  @override
  String goalsDependencyId(int id) {
    return 'Goal #$id';
  }

  @override
  String get goalsHistory => 'Progress history';

  @override
  String goalsCycleSummary(int current, int target) {
    return '$current / $target';
  }

  @override
  String get goalsActiveStrip => 'Active goals';

  @override
  String get goalsViewAll => 'View all goals';

  @override
  String get goalsNudges => 'Insights';

  @override
  String get overviewStatCompleted => 'Completed';

  @override
  String get overviewStatMinutes => 'Minutes today';

  @override
  String get overviewStatStreak => 'Streak';

  @override
  String get overviewDailyProgress => 'Today\'s progress';

  @override
  String get overviewMarkDone => 'Mark done';

  @override
  String get overviewLogTime => 'Log time';

  @override
  String get overviewUndoDone => 'Undo';

  @override
  String get overviewCompletedBadge => 'Done';

  @override
  String get logTimeTitle => 'Log time';

  @override
  String get logTimeMinutes => 'Minutes';

  @override
  String get logTimeInvalid => 'Enter a positive number of minutes';

  @override
  String get logTimeSave => 'Save';

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
  String get overviewAvailableRewards => 'Available rewards';

  @override
  String get overviewViewRewards => 'View all';

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
  String get formAdvanced => 'Advanced';

  @override
  String get formAdvancedConfigured => 'Configured';

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
  String get formNotifications => 'Notifications';

  @override
  String get formNotificationsHint => 'Optional reminders before the activity starts';

  @override
  String get formNotifyAtStart => 'At start';

  @override
  String get formNotify5m => '5 min';

  @override
  String get formNotify15m => '15 min';

  @override
  String get formNotify30m => '30 min';

  @override
  String get formNotify1h => '1 hour';

  @override
  String get formNotify1d => '1 day';

  @override
  String get formNotifyAddCustom => 'Add custom…';

  @override
  String get formNotifyCustomTitle => 'Custom reminder';

  @override
  String get formNotifyCustomMinutes => 'Minutes before start';

  @override
  String get formNotifyCustomInvalid => 'Enter a whole number from 0 to 10080';

  @override
  String get formNotifyMaxReached => 'You can add at most 8 reminders';

  @override
  String get formNotifyAdd => 'Add';

  @override
  String get formNotifyCancel => 'Cancel';

  @override
  String get notificationStartsNow => 'Starting now';

  @override
  String notificationStartsInMinutes(int minutes) {
    return 'Starts in $minutes min';
  }

  @override
  String notificationStartsInHours(int hours) {
    return 'Starts in $hours h';
  }

  @override
  String notificationStartsInDays(int days) {
    return 'Starts in $days d';
  }

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

  @override
  String get rewardsSegmentInventory => 'Inventory';

  @override
  String get rewardsSegmentCatalog => 'Catalog';

  @override
  String get rewardsSegmentHistory => 'History';

  @override
  String get rewardsSearchHint => 'Search rewards';

  @override
  String get rewardsEmptyInventoryTitle => 'No rewards yet';

  @override
  String get rewardsEmptyInventoryHint => 'Earn rewards by completing activities and goals, or create a catalog entry.';

  @override
  String get rewardsEmptyCatalogTitle => 'No reward definitions';

  @override
  String get rewardsEmptyCatalogHint => 'Create rewards you can earn and spend.';

  @override
  String get rewardsEmptyCatalogAction => 'Add reward';

  @override
  String get rewardsEmptyHistoryTitle => 'No history yet';

  @override
  String get rewardsEmptyHistoryHint => 'Earn and consume rewards to see them here.';

  @override
  String get rewardsFormNew => 'New reward';

  @override
  String get rewardsFormEdit => 'Edit reward';

  @override
  String get rewardsFormName => 'Name';

  @override
  String get rewardsFormNameRequired => 'Name is required';

  @override
  String get rewardsFormDescription => 'Description';

  @override
  String get rewardsFormNotes => 'Notes';

  @override
  String get rewardsFormCategory => 'Category';

  @override
  String get rewardsFormTags => 'Tags';

  @override
  String get rewardsFormTagsHint => 'Comma-separated';

  @override
  String get rewardsFormIcon => 'Icon';

  @override
  String get rewardsFormIconHint => 'Emoji or short text';

  @override
  String get rewardsFormStackable => 'Stackable';

  @override
  String get rewardsFormStackableHint => 'Allow multiple copies in inventory';

  @override
  String get rewardsFormImage => 'Image';

  @override
  String get rewardsFormPickImage => 'Choose image';

  @override
  String get rewardsFormClearImage => 'Remove';

  @override
  String get rewardsFormRecentImages => 'Recent uploads';

  @override
  String rewardsFormImageSelected(int id) {
    return 'Selected asset #$id';
  }

  @override
  String get rewardsDetailTitle => 'Reward';

  @override
  String get rewardsNotFound => 'Reward not found';

  @override
  String get rewardsConsumeTitle => 'Use reward';

  @override
  String get rewardsConsumeQuantity => 'Quantity';

  @override
  String get rewardsConsumeNote => 'Note (optional)';

  @override
  String get rewardsConsumeAction => 'Use';

  @override
  String get rewardsDiscardTitle => 'Discard reward?';

  @override
  String rewardsDiscardConfirm(String name) {
    return 'Remove all copies of \"$name\" from inventory?';
  }

  @override
  String get rewardsDiscardAction => 'Discard';

  @override
  String get rewardsDetailHistory => 'Recent history';

  @override
  String get rewardsTxEarn => 'Earned';

  @override
  String get rewardsTxConsume => 'Used';

  @override
  String get rewardsTxDiscard => 'Discarded';

  @override
  String get rewardsTxRestore => 'Restored';

  @override
  String get rewardsTxAdjust => 'Adjusted';

  @override
  String get rewardsRulesSectionTitle => 'Rewards';

  @override
  String get rewardsRulesAdd => 'Add';

  @override
  String get rewardsRulesEmpty => 'No rewards attached yet.';

  @override
  String get rewardsRulesAttachTitle => 'Attach reward';

  @override
  String get rewardsRulesDefinition => 'Reward';

  @override
  String get rewardsRulesQuantity => 'Quantity';

  @override
  String get rewardsRulesAttachAction => 'Attach';

  @override
  String get rewardsRulesDetach => 'Detach';

  @override
  String get rewardsRulesNoDefinitions => 'Create a reward in the catalog first.';

  @override
  String rewardsRulesQtyLabel(int quantity) {
    return '×$quantity';
  }
}

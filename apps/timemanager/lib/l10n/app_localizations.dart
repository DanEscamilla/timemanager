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
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

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
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
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

  /// No description provided for @navGoals.
  ///
  /// In en, this message translates to:
  /// **'Goals'**
  String get navGoals;

  /// No description provided for @navRewards.
  ///
  /// In en, this message translates to:
  /// **'Rewards'**
  String get navRewards;

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

  /// No description provided for @tooltipAddGoal.
  ///
  /// In en, this message translates to:
  /// **'Add goal'**
  String get tooltipAddGoal;

  /// No description provided for @tooltipAddReward.
  ///
  /// In en, this message translates to:
  /// **'Add reward'**
  String get tooltipAddReward;

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

  /// No description provided for @goalsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No goals yet'**
  String get goalsEmptyTitle;

  /// No description provided for @goalsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Create a goal to track completions and time toward a target.'**
  String get goalsEmptyHint;

  /// No description provided for @goalsEmptyAction.
  ///
  /// In en, this message translates to:
  /// **'Add goal'**
  String get goalsEmptyAction;

  /// No description provided for @goalsFilterActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get goalsFilterActive;

  /// No description provided for @goalsFilterScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get goalsFilterScheduled;

  /// No description provided for @goalsFilterPaused.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get goalsFilterPaused;

  /// No description provided for @goalsFilterCompleted.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get goalsFilterCompleted;

  /// No description provided for @goalsFilterArchived.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get goalsFilterArchived;

  /// No description provided for @goalsFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get goalsFilterAll;

  /// No description provided for @goalsStartsAtScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get goalsStartsAtScheduled;

  /// No description provided for @goalsStartsInDays.
  ///
  /// In en, this message translates to:
  /// **'Starts in {days} days'**
  String goalsStartsInDays(int days);

  /// No description provided for @goalsStartsTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Starts tomorrow'**
  String get goalsStartsTomorrow;

  /// No description provided for @goalsStartsToday.
  ///
  /// In en, this message translates to:
  /// **'Starts today'**
  String get goalsStartsToday;

  /// No description provided for @goalsFormStartsAt.
  ///
  /// In en, this message translates to:
  /// **'Start date'**
  String get goalsFormStartsAt;

  /// No description provided for @goalsFormStartsAtCustom.
  ///
  /// In en, this message translates to:
  /// **'Set a start date'**
  String get goalsFormStartsAtCustom;

  /// No description provided for @goalsFormStartsAtHint.
  ///
  /// In en, this message translates to:
  /// **'Leave off to start immediately when created.'**
  String get goalsFormStartsAtHint;

  /// No description provided for @goalsStartsAtConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Move start later?'**
  String get goalsStartsAtConfirmTitle;

  /// No description provided for @goalsStartsAtConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Moving the start date later may remove progress already counted. Continue?'**
  String get goalsStartsAtConfirmBody;

  /// No description provided for @goalsStartsAtConfirmAction.
  ///
  /// In en, this message translates to:
  /// **'Move start'**
  String get goalsStartsAtConfirmAction;

  /// No description provided for @goalsStartingSoon.
  ///
  /// In en, this message translates to:
  /// **'Starting soon'**
  String get goalsStartingSoon;

  /// No description provided for @goalsDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Goal'**
  String get goalsDetailTitle;

  /// No description provided for @goalsNotFound.
  ///
  /// In en, this message translates to:
  /// **'Goal not found'**
  String get goalsNotFound;

  /// No description provided for @goalsDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete goal?'**
  String get goalsDeleteTitle;

  /// No description provided for @goalsDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove \"{title}\" and its progress history?'**
  String goalsDeleteConfirm(String title);

  /// No description provided for @goalsPause.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get goalsPause;

  /// No description provided for @goalsResume.
  ///
  /// In en, this message translates to:
  /// **'Resume'**
  String get goalsResume;

  /// No description provided for @goalsArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get goalsArchive;

  /// No description provided for @goalsProgressPercent.
  ///
  /// In en, this message translates to:
  /// **'{percent}%'**
  String goalsProgressPercent(int percent);

  /// No description provided for @goalsRemainingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} left'**
  String goalsRemainingCount(int count);

  /// No description provided for @goalsRemainingMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes} min left'**
  String goalsRemainingMinutes(int minutes);

  /// No description provided for @goalsDeadlineApproaching.
  ///
  /// In en, this message translates to:
  /// **'Deadline soon'**
  String get goalsDeadlineApproaching;

  /// No description provided for @goalsDeadlineOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get goalsDeadlineOverdue;

  /// No description provided for @goalsDeadlineFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get goalsDeadlineFailed;

  /// No description provided for @goalsRuleActivityCount.
  ///
  /// In en, this message translates to:
  /// **'Complete an activity N times'**
  String get goalsRuleActivityCount;

  /// No description provided for @goalsRuleActivityDuration.
  ///
  /// In en, this message translates to:
  /// **'Time on an activity'**
  String get goalsRuleActivityDuration;

  /// No description provided for @goalsRuleGroupDuration.
  ///
  /// In en, this message translates to:
  /// **'Time on a group'**
  String get goalsRuleGroupDuration;

  /// No description provided for @goalsRuleGroupCount.
  ///
  /// In en, this message translates to:
  /// **'Complete group activities N times'**
  String get goalsRuleGroupCount;

  /// No description provided for @goalsRuleGroupAnyCount.
  ///
  /// In en, this message translates to:
  /// **'Complete any from a group N times'**
  String get goalsRuleGroupAnyCount;

  /// No description provided for @goalsRuleGroupAllComplete.
  ///
  /// In en, this message translates to:
  /// **'Complete all activities in a group'**
  String get goalsRuleGroupAllComplete;

  /// No description provided for @goalsRuleMultiDuration.
  ///
  /// In en, this message translates to:
  /// **'Time across selected activities'**
  String get goalsRuleMultiDuration;

  /// No description provided for @goalsRuleStreak.
  ///
  /// In en, this message translates to:
  /// **'Consecutive-day streak'**
  String get goalsRuleStreak;

  /// No description provided for @goalsRuleTimeOfDay.
  ///
  /// In en, this message translates to:
  /// **'Complete before/after a time'**
  String get goalsRuleTimeOfDay;

  /// No description provided for @goalsRuleComposite.
  ///
  /// In en, this message translates to:
  /// **'Composite (child goals)'**
  String get goalsRuleComposite;

  /// No description provided for @goalsFormNew.
  ///
  /// In en, this message translates to:
  /// **'New goal'**
  String get goalsFormNew;

  /// No description provided for @goalsFormEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit goal'**
  String get goalsFormEdit;

  /// No description provided for @goalsFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get goalsFormTitle;

  /// No description provided for @goalsFormRuleType.
  ///
  /// In en, this message translates to:
  /// **'Goal type'**
  String get goalsFormRuleType;

  /// No description provided for @goalsFormTargetCount.
  ///
  /// In en, this message translates to:
  /// **'Target count'**
  String get goalsFormTargetCount;

  /// No description provided for @goalsFormTargetMinutes.
  ///
  /// In en, this message translates to:
  /// **'Target minutes'**
  String get goalsFormTargetMinutes;

  /// No description provided for @goalsFormTargetInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a positive number'**
  String get goalsFormTargetInvalid;

  /// No description provided for @goalsFormLinkedActivities.
  ///
  /// In en, this message translates to:
  /// **'Linked activities'**
  String get goalsFormLinkedActivities;

  /// No description provided for @goalsFormLinkedGroups.
  ///
  /// In en, this message translates to:
  /// **'Linked groups'**
  String get goalsFormLinkedGroups;

  /// No description provided for @goalsFormDependencies.
  ///
  /// In en, this message translates to:
  /// **'Dependencies'**
  String get goalsFormDependencies;

  /// No description provided for @goalsFormSelectActivity.
  ///
  /// In en, this message translates to:
  /// **'Select at least one activity'**
  String get goalsFormSelectActivity;

  /// No description provided for @goalsFormSelectGroup.
  ///
  /// In en, this message translates to:
  /// **'Select at least one group'**
  String get goalsFormSelectGroup;

  /// No description provided for @goalsFormSelectDependency.
  ///
  /// In en, this message translates to:
  /// **'Select at least one dependency'**
  String get goalsFormSelectDependency;

  /// No description provided for @goalsFormCompositeMode.
  ///
  /// In en, this message translates to:
  /// **'Composite mode'**
  String get goalsFormCompositeMode;

  /// No description provided for @goalsCompositeAll.
  ///
  /// In en, this message translates to:
  /// **'All children'**
  String get goalsCompositeAll;

  /// No description provided for @goalsCompositeAny.
  ///
  /// In en, this message translates to:
  /// **'Any N children'**
  String get goalsCompositeAny;

  /// No description provided for @goalsCompositeWeighted.
  ///
  /// In en, this message translates to:
  /// **'Weighted average'**
  String get goalsCompositeWeighted;

  /// No description provided for @goalsFormBlockUntilUnlocked.
  ///
  /// In en, this message translates to:
  /// **'Block progress until dependencies met'**
  String get goalsFormBlockUntilUnlocked;

  /// No description provided for @goalsFormRecurrence.
  ///
  /// In en, this message translates to:
  /// **'Recurrence'**
  String get goalsFormRecurrence;

  /// No description provided for @goalsFormRecurrencePeriod.
  ///
  /// In en, this message translates to:
  /// **'Repeats'**
  String get goalsFormRecurrencePeriod;

  /// No description provided for @goalsFormOneTime.
  ///
  /// In en, this message translates to:
  /// **'One-time'**
  String get goalsFormOneTime;

  /// No description provided for @goalsFormInterval.
  ///
  /// In en, this message translates to:
  /// **'Interval'**
  String get goalsFormInterval;

  /// No description provided for @goalsRecurrenceQuarterly.
  ///
  /// In en, this message translates to:
  /// **'Quarterly'**
  String get goalsRecurrenceQuarterly;

  /// No description provided for @goalsFormDeadline.
  ///
  /// In en, this message translates to:
  /// **'Deadline'**
  String get goalsFormDeadline;

  /// No description provided for @goalsFormDeadlineKind.
  ///
  /// In en, this message translates to:
  /// **'Deadline type'**
  String get goalsFormDeadlineKind;

  /// No description provided for @goalsFormNoDeadline.
  ///
  /// In en, this message translates to:
  /// **'No deadline'**
  String get goalsFormNoDeadline;

  /// No description provided for @goalsFormDeadlineAbsolute.
  ///
  /// In en, this message translates to:
  /// **'Fixed date'**
  String get goalsFormDeadlineAbsolute;

  /// No description provided for @goalsFormDeadlineRelative.
  ///
  /// In en, this message translates to:
  /// **'Days after cycle starts'**
  String get goalsFormDeadlineRelative;

  /// No description provided for @goalsFormDeadlineDays.
  ///
  /// In en, this message translates to:
  /// **'Days after cycle start'**
  String get goalsFormDeadlineDays;

  /// No description provided for @goalsFormSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get goalsFormSaving;

  /// No description provided for @goalsLinkedSources.
  ///
  /// In en, this message translates to:
  /// **'Linked sources'**
  String get goalsLinkedSources;

  /// No description provided for @goalsDanglingLink.
  ///
  /// In en, this message translates to:
  /// **'Removed source'**
  String get goalsDanglingLink;

  /// No description provided for @goalsDependencies.
  ///
  /// In en, this message translates to:
  /// **'Dependencies'**
  String get goalsDependencies;

  /// No description provided for @goalsDependencyId.
  ///
  /// In en, this message translates to:
  /// **'Goal #{id}'**
  String goalsDependencyId(int id);

  /// No description provided for @goalsHistory.
  ///
  /// In en, this message translates to:
  /// **'Progress history'**
  String get goalsHistory;

  /// No description provided for @goalsCycleSummary.
  ///
  /// In en, this message translates to:
  /// **'{current} / {target}'**
  String goalsCycleSummary(int current, int target);

  /// No description provided for @goalsActiveStrip.
  ///
  /// In en, this message translates to:
  /// **'Active goals'**
  String get goalsActiveStrip;

  /// No description provided for @goalsViewAll.
  ///
  /// In en, this message translates to:
  /// **'View all goals'**
  String get goalsViewAll;

  /// No description provided for @goalsNudges.
  ///
  /// In en, this message translates to:
  /// **'Insights'**
  String get goalsNudges;

  /// No description provided for @overviewStatCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get overviewStatCompleted;

  /// No description provided for @overviewStatMinutes.
  ///
  /// In en, this message translates to:
  /// **'Minutes today'**
  String get overviewStatMinutes;

  /// No description provided for @overviewStatStreak.
  ///
  /// In en, this message translates to:
  /// **'Streak'**
  String get overviewStatStreak;

  /// No description provided for @overviewDailyProgress.
  ///
  /// In en, this message translates to:
  /// **'Today\'s progress'**
  String get overviewDailyProgress;

  /// No description provided for @overviewMarkDone.
  ///
  /// In en, this message translates to:
  /// **'Mark done'**
  String get overviewMarkDone;

  /// No description provided for @overviewLogTime.
  ///
  /// In en, this message translates to:
  /// **'Log time'**
  String get overviewLogTime;

  /// No description provided for @overviewUndoDone.
  ///
  /// In en, this message translates to:
  /// **'Undo'**
  String get overviewUndoDone;

  /// No description provided for @overviewCompletedBadge.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get overviewCompletedBadge;

  /// No description provided for @logTimeTitle.
  ///
  /// In en, this message translates to:
  /// **'Log time'**
  String get logTimeTitle;

  /// No description provided for @logTimeMinutes.
  ///
  /// In en, this message translates to:
  /// **'Minutes'**
  String get logTimeMinutes;

  /// No description provided for @logTimeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a positive number of minutes'**
  String get logTimeInvalid;

  /// No description provided for @logTimeSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get logTimeSave;

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

  /// No description provided for @overviewAvailableRewards.
  ///
  /// In en, this message translates to:
  /// **'Available rewards'**
  String get overviewAvailableRewards;

  /// No description provided for @overviewViewRewards.
  ///
  /// In en, this message translates to:
  /// **'View all'**
  String get overviewViewRewards;

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

  /// No description provided for @formAdvanced.
  ///
  /// In en, this message translates to:
  /// **'Advanced'**
  String get formAdvanced;

  /// No description provided for @formAdvancedConfigured.
  ///
  /// In en, this message translates to:
  /// **'Configured'**
  String get formAdvancedConfigured;

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

  /// No description provided for @formNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get formNotifications;

  /// No description provided for @formNotificationsHint.
  ///
  /// In en, this message translates to:
  /// **'Optional reminders before the activity starts'**
  String get formNotificationsHint;

  /// No description provided for @formNotifyAtStart.
  ///
  /// In en, this message translates to:
  /// **'At start'**
  String get formNotifyAtStart;

  /// No description provided for @formNotify5m.
  ///
  /// In en, this message translates to:
  /// **'5 min'**
  String get formNotify5m;

  /// No description provided for @formNotify15m.
  ///
  /// In en, this message translates to:
  /// **'15 min'**
  String get formNotify15m;

  /// No description provided for @formNotify30m.
  ///
  /// In en, this message translates to:
  /// **'30 min'**
  String get formNotify30m;

  /// No description provided for @formNotify1h.
  ///
  /// In en, this message translates to:
  /// **'1 hour'**
  String get formNotify1h;

  /// No description provided for @formNotify1d.
  ///
  /// In en, this message translates to:
  /// **'1 day'**
  String get formNotify1d;

  /// No description provided for @formNotifyAddCustom.
  ///
  /// In en, this message translates to:
  /// **'Add custom…'**
  String get formNotifyAddCustom;

  /// No description provided for @formNotifyCustomTitle.
  ///
  /// In en, this message translates to:
  /// **'Custom reminder'**
  String get formNotifyCustomTitle;

  /// No description provided for @formNotifyCustomMinutes.
  ///
  /// In en, this message translates to:
  /// **'Minutes before start'**
  String get formNotifyCustomMinutes;

  /// No description provided for @formNotifyCustomInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number from 0 to 10080'**
  String get formNotifyCustomInvalid;

  /// No description provided for @formNotifyMaxReached.
  ///
  /// In en, this message translates to:
  /// **'You can add at most 8 reminders'**
  String get formNotifyMaxReached;

  /// No description provided for @formNotifyAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get formNotifyAdd;

  /// No description provided for @formNotifyCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get formNotifyCancel;

  /// No description provided for @notificationStartsNow.
  ///
  /// In en, this message translates to:
  /// **'Starting now'**
  String get notificationStartsNow;

  /// No description provided for @notificationStartsInMinutes.
  ///
  /// In en, this message translates to:
  /// **'Starts in {minutes} min'**
  String notificationStartsInMinutes(int minutes);

  /// No description provided for @notificationStartsInHours.
  ///
  /// In en, this message translates to:
  /// **'Starts in {hours} h'**
  String notificationStartsInHours(int hours);

  /// No description provided for @notificationStartsInDays.
  ///
  /// In en, this message translates to:
  /// **'Starts in {days} d'**
  String notificationStartsInDays(int days);

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

  /// No description provided for @rewardsSegmentInventory.
  ///
  /// In en, this message translates to:
  /// **'Inventory'**
  String get rewardsSegmentInventory;

  /// No description provided for @rewardsSegmentCatalog.
  ///
  /// In en, this message translates to:
  /// **'Catalog'**
  String get rewardsSegmentCatalog;

  /// No description provided for @rewardsSegmentHistory.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get rewardsSegmentHistory;

  /// No description provided for @rewardsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search rewards'**
  String get rewardsSearchHint;

  /// No description provided for @rewardsEmptyInventoryTitle.
  ///
  /// In en, this message translates to:
  /// **'No rewards yet'**
  String get rewardsEmptyInventoryTitle;

  /// No description provided for @rewardsEmptyInventoryHint.
  ///
  /// In en, this message translates to:
  /// **'Earn rewards by completing activities and goals, or create a catalog entry.'**
  String get rewardsEmptyInventoryHint;

  /// No description provided for @rewardsEmptyCatalogTitle.
  ///
  /// In en, this message translates to:
  /// **'No reward definitions'**
  String get rewardsEmptyCatalogTitle;

  /// No description provided for @rewardsEmptyCatalogHint.
  ///
  /// In en, this message translates to:
  /// **'Create rewards you can earn and spend.'**
  String get rewardsEmptyCatalogHint;

  /// No description provided for @rewardsEmptyCatalogAction.
  ///
  /// In en, this message translates to:
  /// **'Add reward'**
  String get rewardsEmptyCatalogAction;

  /// No description provided for @rewardsEmptyHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'No history yet'**
  String get rewardsEmptyHistoryTitle;

  /// No description provided for @rewardsEmptyHistoryHint.
  ///
  /// In en, this message translates to:
  /// **'Earn and consume rewards to see them here.'**
  String get rewardsEmptyHistoryHint;

  /// No description provided for @rewardsFormNew.
  ///
  /// In en, this message translates to:
  /// **'New reward'**
  String get rewardsFormNew;

  /// No description provided for @rewardsFormEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit reward'**
  String get rewardsFormEdit;

  /// No description provided for @rewardsFormName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get rewardsFormName;

  /// No description provided for @rewardsFormNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Name is required'**
  String get rewardsFormNameRequired;

  /// No description provided for @rewardsFormDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get rewardsFormDescription;

  /// No description provided for @rewardsFormNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get rewardsFormNotes;

  /// No description provided for @rewardsFormCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get rewardsFormCategory;

  /// No description provided for @rewardsFormTags.
  ///
  /// In en, this message translates to:
  /// **'Tags'**
  String get rewardsFormTags;

  /// No description provided for @rewardsFormTagsHint.
  ///
  /// In en, this message translates to:
  /// **'Comma-separated'**
  String get rewardsFormTagsHint;

  /// No description provided for @rewardsFormIcon.
  ///
  /// In en, this message translates to:
  /// **'Icon'**
  String get rewardsFormIcon;

  /// No description provided for @rewardsFormIconHint.
  ///
  /// In en, this message translates to:
  /// **'Emoji or short text'**
  String get rewardsFormIconHint;

  /// No description provided for @rewardsFormStackable.
  ///
  /// In en, this message translates to:
  /// **'Stackable'**
  String get rewardsFormStackable;

  /// No description provided for @rewardsFormStackableHint.
  ///
  /// In en, this message translates to:
  /// **'Allow multiple copies in inventory'**
  String get rewardsFormStackableHint;

  /// No description provided for @rewardsFormImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get rewardsFormImage;

  /// No description provided for @rewardsFormPickImage.
  ///
  /// In en, this message translates to:
  /// **'Choose image'**
  String get rewardsFormPickImage;

  /// No description provided for @rewardsFormClearImage.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get rewardsFormClearImage;

  /// No description provided for @rewardsFormRecentImages.
  ///
  /// In en, this message translates to:
  /// **'Recent uploads'**
  String get rewardsFormRecentImages;

  /// No description provided for @rewardsFormImageSelected.
  ///
  /// In en, this message translates to:
  /// **'Selected asset #{id}'**
  String rewardsFormImageSelected(int id);

  /// No description provided for @rewardsDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Reward'**
  String get rewardsDetailTitle;

  /// No description provided for @rewardsNotFound.
  ///
  /// In en, this message translates to:
  /// **'Reward not found'**
  String get rewardsNotFound;

  /// No description provided for @rewardsConsumeTitle.
  ///
  /// In en, this message translates to:
  /// **'Use reward'**
  String get rewardsConsumeTitle;

  /// No description provided for @rewardsConsumeQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get rewardsConsumeQuantity;

  /// No description provided for @rewardsConsumeNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get rewardsConsumeNote;

  /// No description provided for @rewardsConsumeAction.
  ///
  /// In en, this message translates to:
  /// **'Use'**
  String get rewardsConsumeAction;

  /// No description provided for @rewardsDiscardTitle.
  ///
  /// In en, this message translates to:
  /// **'Discard reward?'**
  String get rewardsDiscardTitle;

  /// No description provided for @rewardsDiscardConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove all copies of \"{name}\" from inventory?'**
  String rewardsDiscardConfirm(String name);

  /// No description provided for @rewardsDiscardAction.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get rewardsDiscardAction;

  /// No description provided for @rewardsDetailHistory.
  ///
  /// In en, this message translates to:
  /// **'Recent history'**
  String get rewardsDetailHistory;

  /// No description provided for @rewardsTxEarn.
  ///
  /// In en, this message translates to:
  /// **'Earned'**
  String get rewardsTxEarn;

  /// No description provided for @rewardsTxConsume.
  ///
  /// In en, this message translates to:
  /// **'Used'**
  String get rewardsTxConsume;

  /// No description provided for @rewardsTxDiscard.
  ///
  /// In en, this message translates to:
  /// **'Discarded'**
  String get rewardsTxDiscard;

  /// No description provided for @rewardsTxRestore.
  ///
  /// In en, this message translates to:
  /// **'Restored'**
  String get rewardsTxRestore;

  /// No description provided for @rewardsTxAdjust.
  ///
  /// In en, this message translates to:
  /// **'Adjusted'**
  String get rewardsTxAdjust;

  /// No description provided for @rewardsRulesSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Rewards'**
  String get rewardsRulesSectionTitle;

  /// No description provided for @rewardsRulesAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get rewardsRulesAdd;

  /// No description provided for @rewardsRulesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No rewards attached yet.'**
  String get rewardsRulesEmpty;

  /// No description provided for @rewardsRulesAttachTitle.
  ///
  /// In en, this message translates to:
  /// **'Attach reward'**
  String get rewardsRulesAttachTitle;

  /// No description provided for @rewardsRulesDefinition.
  ///
  /// In en, this message translates to:
  /// **'Reward'**
  String get rewardsRulesDefinition;

  /// No description provided for @rewardsRulesQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get rewardsRulesQuantity;

  /// No description provided for @rewardsRulesAttachAction.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get rewardsRulesAttachAction;

  /// No description provided for @rewardsRulesDetach.
  ///
  /// In en, this message translates to:
  /// **'Detach'**
  String get rewardsRulesDetach;

  /// No description provided for @rewardsRulesNoDefinitions.
  ///
  /// In en, this message translates to:
  /// **'Create a reward in the catalog first.'**
  String get rewardsRulesNoDefinitions;

  /// No description provided for @rewardsRulesQtyLabel.
  ///
  /// In en, this message translates to:
  /// **'×{quantity}'**
  String rewardsRulesQtyLabel(int quantity);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}

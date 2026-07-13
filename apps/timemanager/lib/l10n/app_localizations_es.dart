// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Time Manager';

  @override
  String get navActivities => 'Actividades';

  @override
  String get navCalendar => 'Calendario';

  @override
  String get navOverview => 'Resumen';

  @override
  String get navGoals => 'Metas';

  @override
  String get tooltipRefresh => 'Actualizar';

  @override
  String get tooltipSignOut => 'Cerrar sesión';

  @override
  String get tooltipAddActivity => 'Añadir actividad';

  @override
  String get tooltipAddActivityForDay => 'Añadir actividad para este día';

  @override
  String get tooltipAddGoal => 'Añadir meta';

  @override
  String get tooltipSettings => 'Ajustes';

  @override
  String get tooltipGroups => 'Grupos';

  @override
  String get tooltipAddGroup => 'Añadir grupo';

  @override
  String get goalsEmptyTitle => 'Aún no hay metas';

  @override
  String get goalsEmptyHint => 'Crea una meta para seguir completaciones y tiempo hacia un objetivo.';

  @override
  String get goalsEmptyAction => 'Añadir meta';

  @override
  String get goalsFilterActive => 'Activas';

  @override
  String get goalsFilterScheduled => 'Programadas';

  @override
  String get goalsFilterPaused => 'Pausadas';

  @override
  String get goalsFilterCompleted => 'Hechas';

  @override
  String get goalsFilterArchived => 'Archivadas';

  @override
  String get goalsFilterAll => 'Todas';

  @override
  String get goalsStartsAtScheduled => 'Programada';

  @override
  String goalsStartsInDays(int days) {
    return 'Empieza en $days días';
  }

  @override
  String get goalsStartsTomorrow => 'Empieza mañana';

  @override
  String get goalsStartsToday => 'Empieza hoy';

  @override
  String get goalsFormStartsAt => 'Fecha de inicio';

  @override
  String get goalsFormStartsAtCustom => 'Definir fecha de inicio';

  @override
  String get goalsFormStartsAtHint => 'Si no la defines, la meta empieza al crearla.';

  @override
  String get goalsStartsAtConfirmTitle => '¿Retrasar el inicio?';

  @override
  String get goalsStartsAtConfirmBody => 'Retrasar la fecha de inicio puede quitar progreso ya contado. ¿Continuar?';

  @override
  String get goalsStartsAtConfirmAction => 'Mover inicio';

  @override
  String get goalsStartingSoon => 'Próximas a empezar';

  @override
  String get goalsDetailTitle => 'Meta';

  @override
  String get goalsNotFound => 'Meta no encontrada';

  @override
  String get goalsDeleteTitle => '¿Eliminar meta?';

  @override
  String goalsDeleteConfirm(String title) {
    return '¿Quitar \"$title\" y su historial de progreso?';
  }

  @override
  String get goalsPause => 'Pausar';

  @override
  String get goalsResume => 'Reanudar';

  @override
  String get goalsArchive => 'Archivar';

  @override
  String goalsProgressPercent(int percent) {
    return '$percent%';
  }

  @override
  String goalsRemainingCount(int count) {
    return '$count restantes';
  }

  @override
  String goalsRemainingMinutes(int minutes) {
    return '$minutes min restantes';
  }

  @override
  String get goalsDeadlineApproaching => 'Fecha cercana';

  @override
  String get goalsDeadlineOverdue => 'Vencida';

  @override
  String get goalsDeadlineFailed => 'Fallida';

  @override
  String get goalsRuleActivityCount => 'Completar una actividad N veces';

  @override
  String get goalsRuleActivityDuration => 'Tiempo en una actividad';

  @override
  String get goalsRuleGroupDuration => 'Tiempo en un grupo';

  @override
  String get goalsRuleGroupCount => 'Completar actividades del grupo N veces';

  @override
  String get goalsRuleGroupAnyCount => 'Completar cualquiera del grupo N veces';

  @override
  String get goalsRuleGroupAllComplete => 'Completar todas las actividades del grupo';

  @override
  String get goalsRuleMultiDuration => 'Tiempo en actividades seleccionadas';

  @override
  String get goalsRuleStreak => 'Racha de días consecutivos';

  @override
  String get goalsRuleTimeOfDay => 'Completar antes/después de una hora';

  @override
  String get goalsRuleComposite => 'Compuesta (metas hijas)';

  @override
  String get goalsFormNew => 'Nueva meta';

  @override
  String get goalsFormEdit => 'Editar meta';

  @override
  String get goalsFormTitle => 'Título';

  @override
  String get goalsFormRuleType => 'Tipo de meta';

  @override
  String get goalsFormTargetCount => 'Objetivo (veces)';

  @override
  String get goalsFormTargetMinutes => 'Objetivo (minutos)';

  @override
  String get goalsFormTargetInvalid => 'Introduce un número positivo';

  @override
  String get goalsFormLinkedActivities => 'Actividades vinculadas';

  @override
  String get goalsFormLinkedGroups => 'Grupos vinculados';

  @override
  String get goalsFormDependencies => 'Dependencias';

  @override
  String get goalsFormSelectActivity => 'Selecciona al menos una actividad';

  @override
  String get goalsFormSelectGroup => 'Selecciona al menos un grupo';

  @override
  String get goalsFormSelectDependency => 'Selecciona al menos una dependencia';

  @override
  String get goalsFormCompositeMode => 'Modo compuesto';

  @override
  String get goalsCompositeAll => 'Todas las hijas';

  @override
  String get goalsCompositeAny => 'Cualquier N hijas';

  @override
  String get goalsCompositeWeighted => 'Promedio ponderado';

  @override
  String get goalsFormBlockUntilUnlocked => 'Bloquear progreso hasta cumplir dependencias';

  @override
  String get goalsFormRecurrence => 'Recurrencia';

  @override
  String get goalsFormRecurrencePeriod => 'Se repite';

  @override
  String get goalsFormOneTime => 'Una sola vez';

  @override
  String get goalsFormInterval => 'Intervalo';

  @override
  String get goalsRecurrenceQuarterly => 'Trimestral';

  @override
  String get goalsFormDeadline => 'Fecha límite';

  @override
  String get goalsFormDeadlineKind => 'Tipo de fecha límite';

  @override
  String get goalsFormNoDeadline => 'Sin fecha límite';

  @override
  String get goalsFormDeadlineAbsolute => 'Fecha fija';

  @override
  String get goalsFormDeadlineRelative => 'Días tras inicio del ciclo';

  @override
  String get goalsFormDeadlineDays => 'Días tras el inicio del ciclo';

  @override
  String get goalsFormSaving => 'Guardando…';

  @override
  String get goalsLinkedSources => 'Fuentes vinculadas';

  @override
  String get goalsDanglingLink => 'Fuente eliminada';

  @override
  String get goalsDependencies => 'Dependencias';

  @override
  String goalsDependencyId(int id) {
    return 'Meta #$id';
  }

  @override
  String get goalsHistory => 'Historial de progreso';

  @override
  String goalsCycleSummary(int current, int target) {
    return '$current / $target';
  }

  @override
  String get goalsActiveStrip => 'Metas activas';

  @override
  String get goalsViewAll => 'Ver todas las metas';

  @override
  String get goalsNudges => 'Ideas';

  @override
  String get overviewStatCompleted => 'Completadas';

  @override
  String get overviewStatMinutes => 'Minutos hoy';

  @override
  String get overviewStatStreak => 'Racha';

  @override
  String get overviewDailyProgress => 'Progreso de hoy';

  @override
  String get overviewMarkDone => 'Marcar hecha';

  @override
  String get overviewLogTime => 'Registrar tiempo';

  @override
  String get overviewUndoDone => 'Deshacer';

  @override
  String get overviewCompletedBadge => 'Hecha';

  @override
  String get logTimeTitle => 'Registrar tiempo';

  @override
  String get logTimeMinutes => 'Minutos';

  @override
  String get logTimeInvalid => 'Introduce un número positivo de minutos';

  @override
  String get logTimeSave => 'Guardar';

  @override
  String get groupsTitle => 'Grupos';

  @override
  String get groupsEmptyTitle => 'Aún no hay grupos';

  @override
  String get groupsEmptyHint => 'Crea un grupo para organizar tus actividades por color.';

  @override
  String get groupsEmptyAction => 'Añadir grupo';

  @override
  String get groupsDeleteTitle => '¿Eliminar grupo?';

  @override
  String groupsDeleteConfirm(String name) {
    return '¿Quitar \"$name\"? Las actividades de este grupo quedarán sin grupo.';
  }

  @override
  String get groupsDeleted => 'Grupo eliminado';

  @override
  String get formEditGroup => 'Editar grupo';

  @override
  String get formNewGroup => 'Nuevo grupo';

  @override
  String get formGroupName => 'Nombre';

  @override
  String get formGroupNameRequired => 'El nombre es obligatorio';

  @override
  String get formGroupColor => 'Color';

  @override
  String get formGroup => 'Grupo';

  @override
  String get formNoGroup => 'Sin grupo';

  @override
  String get settingsTitle => 'Ajustes';

  @override
  String get settingsTheme => 'Tema';

  @override
  String get settingsThemeSystem => 'Sistema';

  @override
  String get settingsThemeLight => 'Claro';

  @override
  String get settingsThemeDark => 'Oscuro';

  @override
  String get settingsSignOut => 'Cerrar sesión';

  @override
  String get overviewGreeting => 'Hola';

  @override
  String overviewTodayDate(String date) {
    return '$date';
  }

  @override
  String get overviewStatToday => 'Hoy';

  @override
  String get overviewStatWeek => 'Esta semana';

  @override
  String get overviewStatRecurring => 'Recurrentes';

  @override
  String get overviewTodaySchedule => 'Agenda de hoy';

  @override
  String get overviewUpcoming => 'Próximas';

  @override
  String get overviewQuickActions => 'Acciones rápidas';

  @override
  String get overviewAddActivity => 'Añadir actividad';

  @override
  String get overviewOpenCalendar => 'Abrir calendario';

  @override
  String get overviewEmptyToday => 'Nada programado hoy';

  @override
  String get overviewEmptyTodayHint => 'Añade una actividad para llenar tu día.';

  @override
  String get overviewEmptyUpcoming => 'No hay actividades próximas';

  @override
  String get overviewViewAll => 'Ver todas las actividades';

  @override
  String get calendarEmptyHint => 'No hay eventos en este rango. Toca + para añadir uno.';

  @override
  String get activitiesEmptyTitle => 'Aún no hay actividades';

  @override
  String get activitiesEmptyHint => 'Toca + para añadir tu primera actividad.';

  @override
  String get activitiesEmptyAction => 'Añadir actividad';

  @override
  String get loginCreateAccount => 'Crear una cuenta';

  @override
  String get loginSignInContinue => 'Inicia sesión para continuar';

  @override
  String get loginEmail => 'Correo electrónico';

  @override
  String get loginEmailRequired => 'El correo electrónico es obligatorio';

  @override
  String get loginEmailInvalid => 'Introduce un correo electrónico válido';

  @override
  String get loginPassword => 'Contraseña';

  @override
  String get loginPasswordRequired => 'La contraseña es obligatoria';

  @override
  String get loginPasswordTooShort => 'Usa al menos 8 caracteres';

  @override
  String get loginSignUp => 'Registrarse';

  @override
  String get loginSignIn => 'Iniciar sesión';

  @override
  String get loginAlreadyHaveAccount => '¿Ya tienes una cuenta? Inicia sesión';

  @override
  String get loginNeedAccount => '¿Necesitas una cuenta? Regístrate';

  @override
  String get loginOrContinueWith => 'O continúa con';

  @override
  String get providerGoogle => 'Google';

  @override
  String get providerGitHub => 'GitHub';

  @override
  String get providerApple => 'Apple';

  @override
  String get providerTwitter => 'Twitter';

  @override
  String get authActionSignUp => 'Registro';

  @override
  String get authActionSignIn => 'Inicio de sesión';

  @override
  String get authActionOAuth => 'Inicio de sesión OAuth';

  @override
  String authFailedStatus(String action, String status) {
    return '$action falló ($status)';
  }

  @override
  String authNoSessionToken(String action) {
    return '$action se completó pero no se devolvió ningún token de sesión';
  }

  @override
  String authStartOAuthFailed(String provider, int statusCode) {
    return 'No se pudo iniciar el inicio de sesión con $provider ($statusCode)';
  }

  @override
  String get authAuthorisationUrlMissing => 'Falta la URL de autorización en la respuesta';

  @override
  String get authCouldNotGetAuthorisationUrl => 'No se pudo obtener la URL de autorización';

  @override
  String authCouldNotOpenLogin(String provider) {
    return 'No se pudo abrir el inicio de sesión con $provider';
  }

  @override
  String get errorNotSignedIn => 'No has iniciado sesión';

  @override
  String get errorSessionExpired => 'La sesión ha caducado. Vuelve a iniciar sesión.';

  @override
  String errorRequestFailed(int statusCode, String body) {
    return 'La solicitud falló ($statusCode): $body';
  }

  @override
  String get errorNoGraphQlData => 'No hay datos en la respuesta de GraphQL';

  @override
  String get errorUnknown => 'Error desconocido';

  @override
  String get errorCouldNotLoadActivities => 'No se pudieron cargar las actividades';

  @override
  String get errorRetry => 'Reintentar';

  @override
  String get activitiesEmpty => 'Aún no hay actividades.\nToca + para añadir una.';

  @override
  String get activitiesDeleteTitle => '¿Eliminar actividad?';

  @override
  String activitiesDeleteConfirm(String title) {
    return '¿Eliminar \"$title\"?';
  }

  @override
  String get activitiesCancel => 'Cancelar';

  @override
  String get activitiesDelete => 'Eliminar';

  @override
  String get activitiesDeleted => 'Actividad eliminada';

  @override
  String get activitiesEdit => 'Editar';

  @override
  String get activitiesRecurring => 'Recurrente';

  @override
  String get calendarDay => 'Día';

  @override
  String get calendarWeek => 'Semana';

  @override
  String get calendarMonth => 'Mes';

  @override
  String get formEditActivity => 'Editar actividad';

  @override
  String get formNewActivity => 'Nueva actividad';

  @override
  String get formTitle => 'Título';

  @override
  String get formTitleRequired => 'El título es obligatorio';

  @override
  String get formDescriptionOptional => 'Descripción (opcional)';

  @override
  String get formStart => 'Inicio';

  @override
  String get formEnd => 'Fin';

  @override
  String get formRecurring => 'Recurrente';

  @override
  String get formOneTime => 'Única';

  @override
  String get formRepeatsOnSchedule => 'Se repite según un horario';

  @override
  String get formHappensOnSingleDate => 'Ocurre en una sola fecha';

  @override
  String get formDate => 'Fecha';

  @override
  String get formSelectDate => 'Seleccionar fecha';

  @override
  String get formRepeats => 'Se repite';

  @override
  String get formStarts => 'Comienza';

  @override
  String get formSelectStartDate => 'Seleccionar fecha de inicio';

  @override
  String get formEndsOptional => 'Termina (opcional)';

  @override
  String get formNoEndDate => 'Sin fecha de fin';

  @override
  String get formClearEndDate => 'Borrar fecha de fin';

  @override
  String get formDaysOfWeek => 'Días de la semana';

  @override
  String get formDaysOfMonth => 'Días del mes';

  @override
  String get formLastDayOfMonth => 'Último día del mes';

  @override
  String get formRepeatEveryNDays => 'Repetir cada N días';

  @override
  String get formIntervalAtLeastOne => 'Introduce un entero de al menos 1';

  @override
  String get formSaveChanges => 'Guardar cambios';

  @override
  String get formCreate => 'Crear';

  @override
  String get formEndTimeAfterStart => 'La hora de fin debe ser posterior a la de inicio';

  @override
  String get formDateRequired => 'La fecha es obligatoria para actividades únicas';

  @override
  String get formRecurrenceStartRequired => 'La fecha de inicio de la recurrencia es obligatoria';

  @override
  String get formEndDateAfterStart => 'La fecha de fin debe ser igual o posterior a la de inicio';

  @override
  String get formSelectWeekday => 'Selecciona al menos un día de la semana';

  @override
  String get formSelectMonthDay => 'Selecciona al menos un día del mes, o el último día';

  @override
  String get formIntervalInvalid => 'El intervalo debe ser un entero de al menos 1';

  @override
  String get weekdaySun => 'Dom';

  @override
  String get weekdayMon => 'Lun';

  @override
  String get weekdayTue => 'Mar';

  @override
  String get weekdayWed => 'Mié';

  @override
  String get weekdayThu => 'Jue';

  @override
  String get weekdayFri => 'Vie';

  @override
  String get weekdaySat => 'Sáb';

  @override
  String get recurrenceWeekly => 'Semanal';

  @override
  String get recurrenceMonthly => 'Mensual';

  @override
  String get recurrenceEveryXDays => 'Cada X días';

  @override
  String recurrenceWeeklyWithDays(String days) {
    return 'Semanal · $days';
  }

  @override
  String recurrenceMonthlyWithParts(String parts) {
    return 'Mensual · $parts';
  }

  @override
  String get recurrenceLastDay => 'último día';

  @override
  String get recurrenceEveryDay => 'Todos los días';

  @override
  String recurrenceEveryNDays(int count) {
    return 'Cada $count días';
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

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
  String get tooltipRefresh => 'Actualizar';

  @override
  String get tooltipSignOut => 'Cerrar sesión';

  @override
  String get tooltipAddActivity => 'Añadir actividad';

  @override
  String get tooltipAddActivityForDay => 'Añadir actividad para este día';

  @override
  String get tooltipSettings => 'Ajustes';

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

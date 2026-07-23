// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Gestor de gastos';

  @override
  String get navOverview => 'Resumen';

  @override
  String get navExpenses => 'Gastos';

  @override
  String get navCategories => 'Categorías';

  @override
  String get navBudgets => 'Presupuestos';

  @override
  String get tooltipRefresh => 'Actualizar';

  @override
  String get tooltipSignOut => 'Cerrar sesión';

  @override
  String get tooltipSettings => 'Ajustes';

  @override
  String get tooltipAddExpense => 'Añadir gasto';

  @override
  String get tooltipAddCategory => 'Añadir categoría';

  @override
  String get tooltipAddBudget => 'Añadir presupuesto';

  @override
  String get loginCreateAccount => 'Crear una cuenta';

  @override
  String get loginSignInContinue => 'Inicia sesión para continuar';

  @override
  String get loginEmail => 'Correo';

  @override
  String get loginEmailRequired => 'El correo es obligatorio';

  @override
  String get loginEmailInvalid => 'Introduce un correo válido';

  @override
  String get loginPassword => 'Contraseña';

  @override
  String get loginPasswordRequired => 'La contraseña es obligatoria';

  @override
  String get loginPasswordTooShort => 'Usa al menos 8 caracteres';

  @override
  String get loginShowPassword => 'Mostrar contraseña';

  @override
  String get loginHidePassword => 'Ocultar contraseña';

  @override
  String get loginRememberDevice => 'Recordar este dispositivo';

  @override
  String get loginSignUp => 'Registrarse';

  @override
  String get loginSignIn => 'Iniciar sesión';

  @override
  String get loginAlreadyHaveAccount => '¿Ya tienes cuenta? Inicia sesión';

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
    return '$action tuvo éxito pero no se devolvió un token de sesión';
  }

  @override
  String authStartOAuthFailed(String provider, int statusCode) {
    return 'No se pudo iniciar el acceso con $provider ($statusCode)';
  }

  @override
  String get authAuthorisationUrlMissing =>
      'Falta la URL de autorización en la respuesta';

  @override
  String get authCouldNotGetAuthorisationUrl =>
      'No se pudo obtener la URL de autorización';

  @override
  String authCouldNotOpenLogin(String provider) {
    return 'No se pudo abrir el acceso con $provider';
  }

  @override
  String get errorNotSignedIn => 'No has iniciado sesión';

  @override
  String get errorSessionExpired =>
      'La sesión caducó. Vuelve a iniciar sesión.';

  @override
  String errorRequestFailed(int statusCode, String body) {
    return 'La solicitud falló ($statusCode): $body';
  }

  @override
  String get errorNoGraphQlData => 'Sin datos en la respuesta GraphQL';

  @override
  String get errorUnknown => 'Error desconocido';

  @override
  String get errorCouldNotLoad => 'No se pudieron cargar los datos';

  @override
  String get errorRetry => 'Reintentar';

  @override
  String get cancel => 'Cancelar';

  @override
  String get save => 'Guardar';

  @override
  String get delete => 'Eliminar';

  @override
  String get archive => 'Archivar';

  @override
  String get expensesEmptyTitle => 'Aún no hay gastos';

  @override
  String get expensesEmptyHint => 'Toca + para registrar tu primer gasto.';

  @override
  String get expensesEmptyAction => 'Añadir gasto';

  @override
  String get expensesDeleteTitle => '¿Eliminar gasto?';

  @override
  String get expensesDeleteConfirm => '¿Quitar este gasto?';

  @override
  String get expensesFormNew => 'Nuevo gasto';

  @override
  String get expensesFormEdit => 'Editar gasto';

  @override
  String get expensesFormAmount => 'Importe';

  @override
  String get expensesFormAmountRequired => 'Introduce un importe';

  @override
  String get expensesFormAmountInvalid =>
      'Introduce un importe válido (p. ej. 12.50)';

  @override
  String get expensesFormCategory => 'Categoría';

  @override
  String get expensesFormCategoryRequired => 'Elige una categoría';

  @override
  String get expensesFormDate => 'Fecha';

  @override
  String get expensesFormNote => 'Nota';

  @override
  String get expensesFormCurrency => 'Moneda';

  @override
  String get categoriesEmptyTitle => 'Aún no hay categorías';

  @override
  String get categoriesEmptyHint =>
      'Crea categorías para organizar tus gastos.';

  @override
  String get categoriesEmptyAction => 'Añadir categoría';

  @override
  String get categoriesArchiveTitle => '¿Archivar categoría?';

  @override
  String categoriesArchiveConfirm(String name) {
    return '¿Archivar \"$name\"? Los gastos existentes conservan esta categoría.';
  }

  @override
  String get categoriesFormNew => 'Nueva categoría';

  @override
  String get categoriesFormEdit => 'Editar categoría';

  @override
  String get categoriesFormName => 'Nombre';

  @override
  String get categoriesFormNameRequired => 'El nombre es obligatorio';

  @override
  String get categoriesFormColor => 'Color';

  @override
  String get overviewTitle => 'Este mes';

  @override
  String get overviewEmpty => 'Aún no hay gastos en este periodo.';

  @override
  String get overviewTotal => 'Total';

  @override
  String get overviewByCategory => 'Por categoría';

  @override
  String get overviewBudgets => 'Presupuestos';

  @override
  String overviewBudgetAlert(int percent) {
    return 'Alcanzaste el $percent% de este presupuesto';
  }

  @override
  String get budgetsEmptyTitle => 'Aún no hay presupuestos';

  @override
  String get budgetsEmptyHint => 'Define un límite total o por categoría.';

  @override
  String get budgetsEmptyAction => 'Añadir presupuesto';

  @override
  String get budgetsArchiveTitle => '¿Archivar presupuesto?';

  @override
  String budgetsArchiveConfirm(String name) {
    return '¿Archivar \"$name\"?';
  }

  @override
  String get budgetsFormNew => 'Nuevo presupuesto';

  @override
  String get budgetsFormEdit => 'Editar presupuesto';

  @override
  String get budgetsFormName => 'Nombre';

  @override
  String get budgetsFormNameRequired => 'El nombre es obligatorio';

  @override
  String get budgetsFormScope => 'Alcance';

  @override
  String get budgetsScopeTotal => 'Gasto total';

  @override
  String get budgetsScopeCategory => 'Categoría';

  @override
  String get budgetsFormCategory => 'Categoría';

  @override
  String get budgetsFormCategoryRequired => 'Elige una categoría';

  @override
  String get budgetsFormAmount => 'Importe';

  @override
  String get budgetsFormAmountRequired => 'Introduce un importe';

  @override
  String get budgetsFormAmountInvalid =>
      'Introduce un importe válido (p. ej. 12.50)';

  @override
  String get budgetsFormInterval => 'Se repite cada';

  @override
  String get budgetsFormIntervalCount => 'Cantidad';

  @override
  String get budgetsFormIntervalCountInvalid => 'Introduce un entero ≥ 1';

  @override
  String get budgetsFormIntervalUnit => 'Unidad';

  @override
  String get budgetsIntervalUnitDay => 'Días';

  @override
  String get budgetsIntervalUnitWeek => 'Semanas';

  @override
  String get budgetsIntervalUnitMonth => 'Meses';

  @override
  String budgetsIntervalEveryDays(int count) {
    return 'Cada $count días';
  }

  @override
  String budgetsIntervalEveryWeeks(int count) {
    return 'Cada $count semanas';
  }

  @override
  String budgetsIntervalEveryMonths(int count) {
    return 'Cada $count meses';
  }

  @override
  String get budgetsFormAnchorDate => 'Inicio del periodo';

  @override
  String get budgetsFormAlertPercent => 'Avisar al';

  @override
  String get budgetsFormAlertPercentInvalid =>
      'Introduce un porcentaje entre 1 y 100';

  @override
  String budgetsAlertAt(int percent) {
    return 'Aviso al $percent%';
  }

  @override
  String budgetAlertTitle(String name) {
    return 'Alerta de presupuesto: $name';
  }

  @override
  String budgetAlertBody(int percent, String spent, String amount) {
    return '$percent% usado ($spent / $amount)';
  }

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
  String get settingsEmailImport => 'Importar email';

  @override
  String get settingsEmailImportSubtitle =>
      'Conecta buzones, plantillas y revisa gastos';

  @override
  String get emailImportTitle => 'Importar email';

  @override
  String get emailImportTabSetup => 'Configuración';

  @override
  String get emailImportTabTemplates => 'Plantillas';

  @override
  String get emailImportTabReview => 'Revisión';

  @override
  String get emailImportSetupBlurb =>
      'Conecta un buzón, permite dominios (comodines), sincroniza y genera plantillas de IA una vez por tipo de remitente.';

  @override
  String get emailImportAddFixture => 'Añadir buzón demo';

  @override
  String get emailImportConnectGmail => 'Conectar Gmail';

  @override
  String get emailImportFixtureLabel => 'Buzón demo';

  @override
  String get emailImportGmailLabel => 'Gmail';

  @override
  String get emailImportGmailConnected =>
      'Gmail conectado. Sincroniza para importar mensajes.';

  @override
  String emailImportGmailFailed(String detail) {
    return 'Falló la conexión con Gmail: $detail';
  }

  @override
  String get emailImportGmailFailedGeneric =>
      'Falló la conexión con Gmail. Inténtalo de nuevo.';

  @override
  String get emailImportGmailLaunchFailed =>
      'No se pudo abrir el inicio de sesión de Google.';

  @override
  String get emailImportCancel => 'Cancelar';

  @override
  String get emailImportSave => 'Guardar';

  @override
  String get emailImportNoMailbox =>
      'Aún no hay buzón. Añade uno demo o conecta Gmail.';

  @override
  String get emailImportMailbox => 'Buzón';

  @override
  String get emailImportRenameMailbox => 'Renombrar buzón';

  @override
  String get emailImportRenameMailboxTitle => 'Renombrar buzón';

  @override
  String get emailImportMailboxName => 'Nombre';

  @override
  String get emailImportDeleteMailbox => 'Eliminar buzón';

  @override
  String get emailImportDeleteMailboxTitle => '¿Eliminar buzón?';

  @override
  String emailImportDeleteMailboxConfirm(String label) {
    return '¿Quitar \"$label\"? Se eliminarán los mensajes, filtros y plantillas sincronizados de este buzón.';
  }

  @override
  String get emailImportDomainFilters => 'Lista de dominios remitentes';

  @override
  String get emailImportDomainFiltersHint =>
      'Un patrón por línea. Ejemplos: amazon.com, *.uber.com, *@shop.com (el comodín necesita *.).';

  @override
  String get emailImportNoFilters => 'Sin filtros (todos los remitentes)';

  @override
  String get emailImportTriggerSync => 'Sincronizar ahora';

  @override
  String get emailImportSyncQueued =>
      'Sincronización solicitada. Actualiza en un momento.';

  @override
  String get emailImportMessages => 'Mensajes recientes';

  @override
  String get emailImportNoMessages =>
      'Aún no hay mensajes. Sincroniza tras conectar.';

  @override
  String get emailImportGenerateTemplate => 'Generar plantilla con IA';

  @override
  String get emailImportGeneratingTemplate =>
      'Generando plantilla… Esto puede tardar un momento.';

  @override
  String get emailImportTemplateGenerated =>
      'Plantilla generada. Puedes editarla en la pestaña Plantillas.';

  @override
  String get emailImportTemplateGenerationFailed =>
      'No se pudo generar la plantilla. Inténtalo de nuevo.';

  @override
  String get emailImportNoTemplates =>
      'Aún no hay plantillas. Genera una desde un mensaje en Configuración.';

  @override
  String get emailImportEditTemplate => 'Editar plantilla';

  @override
  String get emailImportTemplateName => 'Nombre';

  @override
  String get emailImportMatchFrom => 'Patrón de remitente';

  @override
  String get emailImportMatchSubject => 'Regex de asunto (opcional)';

  @override
  String get emailImportExtractorsJson => 'JSON de extractores';

  @override
  String get emailImportNoPending => 'No hay candidatos de gasto pendientes.';

  @override
  String get emailImportAcceptTitle => 'Aceptar como gasto';

  @override
  String get emailImportCategory => 'Categoría';

  @override
  String get emailImportAccept => 'Aceptar';

  @override
  String get emailImportReject => 'Rechazar';

  @override
  String get emailImportNeedCategory =>
      'Crea una categoría antes de aceptar gastos.';

  @override
  String get emailImportViewEmail => 'Ver email';

  @override
  String get sourceEmailTitle => 'Email de origen';

  @override
  String get sourceEmailBodyMissing =>
      'No se guardó el cuerpo de este mensaje.';

  @override
  String get sourceEmailNotFound =>
      'No hay un email de origen vinculado a este gasto.';

  @override
  String get sourceEmailLoadFailed => 'No se pudo cargar el email de origen.';
}

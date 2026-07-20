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
  String get authAuthorisationUrlMissing => 'Falta la URL de autorización en la respuesta';

  @override
  String get authCouldNotGetAuthorisationUrl => 'No se pudo obtener la URL de autorización';

  @override
  String authCouldNotOpenLogin(String provider) {
    return 'No se pudo abrir el acceso con $provider';
  }

  @override
  String get errorNotSignedIn => 'No has iniciado sesión';

  @override
  String get errorSessionExpired => 'La sesión caducó. Vuelve a iniciar sesión.';

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
  String get expensesFormAmountInvalid => 'Introduce un importe válido (p. ej. 12.50)';

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
  String get categoriesEmptyHint => 'Crea categorías para organizar tus gastos.';

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
  String get budgetsFormAmountInvalid => 'Introduce un importe válido (p. ej. 12.50)';

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
  String get budgetsFormAlertPercentInvalid => 'Introduce un porcentaje entre 1 y 100';

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
}

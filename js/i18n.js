/* ==========================================================================
   i18n.js — localization (F099)

   Honest scope: translating every screen's copy word-for-word is a
   professional localization job, not something to fake with machine output
   nobody has reviewed. What's real here: a working translation layer
   (dictionary lookup, locale-aware date/number formatting via Intl, which
   utils.js already leans on), wired to the app chrome a student sees on
   every screen — the sidebar nav, the page titles, and shared UI vocabulary.

   What is NOT translated: per-view body copy — button labels inside a view,
   card headings, hint text, empty-state prose. Those still render in English
   whatever the locale. Switching language visibly changes the app's frame,
   not yet its contents.

   Adding a language means adding one entry to DICT; nothing else changes.
   Deepening coverage means adding keys here and calling t() at the call site.
   ========================================================================== */

App.i18n = (function () {
  const S = App.store;

  const DICT = {
    en: {
      assistant: "Assistant",
      // shared UI vocabulary — wired to page titles and common controls
      edit: "Edit", done: "Done", open: "Open", back: "Back", next: "Next",
      today: "Today", week: "Week", month: "Month", all: "All",
      new_item: "New", import_label: "Import", export_label: "Export", print: "Print",
      search: "Search", filter: "Filter", sort: "Sort", loading: "Loading…",
      due: "Due", completed: "Completed", upcoming: "Upcoming", nothing_due: "Nothing due",
      this_week: "This week", no_results: "No results",
      dashboard: "Dashboard", calendar: "Calendar", schedule: "Schedule", planner: "Planner",
      homework: "Homework", classes: "Classes", grades: "Grades", focus: "Focus timer",
      flashcards: "Flashcards", notes: "Notes", reading: "Reading", activities: "Activities",
      goals: "Goals", college: "Applications", contacts: "Contacts", sharing: "Sharing",
      groups: "Study groups", parent: "Parent portal", analytics: "Analytics", settings: "Settings",
      save: "Save", cancel: "Cancel", delete: "Delete", close: "Close", add: "Add",
      due_today: "Today", due_tomorrow: "Tomorrow", overdue: "Overdue",
      empty_generic: "Nothing here yet", search_placeholder: "Search or jump to…"
    },
    es: {
      assistant: "Asistente",
      edit: "Editar", done: "Hecho", open: "Abrir", back: "Atrás", next: "Siguiente",
      today: "Hoy", week: "Semana", month: "Mes", all: "Todo",
      new_item: "Nuevo", import_label: "Importar", export_label: "Exportar", print: "Imprimir",
      search: "Buscar", filter: "Filtrar", sort: "Ordenar", loading: "Cargando…",
      due: "Vence", completed: "Completado", upcoming: "Próximo", nothing_due: "Nada pendiente",
      this_week: "Esta semana", no_results: "Sin resultados",
      dashboard: "Panel", calendar: "Calendario", schedule: "Horario", planner: "Planificador",
      homework: "Tareas", classes: "Clases", grades: "Calificaciones", focus: "Temporizador",
      flashcards: "Tarjetas", notes: "Notas", reading: "Lectura", activities: "Actividades",
      goals: "Metas", college: "Solicitudes", contacts: "Contactos", sharing: "Compartir",
      groups: "Grupos de estudio", parent: "Portal de padres", analytics: "Analítica", settings: "Configuración",
      save: "Guardar", cancel: "Cancelar", delete: "Eliminar", close: "Cerrar", add: "Añadir",
      due_today: "Hoy", due_tomorrow: "Mañana", overdue: "Atrasado",
      empty_generic: "Nada aquí todavía", search_placeholder: "Buscar o ir a…"
    },
    fr: {
      assistant: "Assistant",
      edit: "Modifier", done: "Terminé", open: "Ouvrir", back: "Retour", next: "Suivant",
      today: "Aujourd'hui", week: "Semaine", month: "Mois", all: "Tout",
      new_item: "Nouveau", import_label: "Importer", export_label: "Exporter", print: "Imprimer",
      search: "Rechercher", filter: "Filtrer", sort: "Trier", loading: "Chargement…",
      due: "Échéance", completed: "Terminé", upcoming: "À venir", nothing_due: "Rien à rendre",
      this_week: "Cette semaine", no_results: "Aucun résultat",
      dashboard: "Tableau de bord", calendar: "Calendrier", schedule: "Horaire", planner: "Planificateur",
      homework: "Devoirs", classes: "Cours", grades: "Notes", focus: "Minuteur",
      flashcards: "Cartes", notes: "Notes", reading: "Lecture", activities: "Activités",
      goals: "Objectifs", college: "Candidatures", contacts: "Contacts", sharing: "Partage",
      groups: "Groupes d'étude", parent: "Portail parent", analytics: "Analytique", settings: "Paramètres",
      save: "Enregistrer", cancel: "Annuler", delete: "Supprimer", close: "Fermer", add: "Ajouter",
      due_today: "Aujourd'hui", due_tomorrow: "Demain", overdue: "En retard",
      empty_generic: "Rien ici pour l'instant", search_placeholder: "Rechercher…"
    },
    zh: {
      assistant: "助手",
      edit: "编辑", done: "完成", open: "打开", back: "返回", next: "下一个",
      today: "今天", week: "周", month: "月", all: "全部",
      new_item: "新建", import_label: "导入", export_label: "导出", print: "打印",
      search: "搜索", filter: "筛选", sort: "排序", loading: "加载中…",
      due: "截止", completed: "已完成", upcoming: "即将到来", nothing_due: "暂无待办",
      this_week: "本周", no_results: "无结果",
      dashboard: "仪表盘", calendar: "日历", schedule: "课表", planner: "计划",
      homework: "作业", classes: "课程", grades: "成绩", focus: "专注计时",
      flashcards: "抽认卡", notes: "笔记", reading: "阅读", activities: "活动",
      goals: "目标", college: "申请", contacts: "联系人", sharing: "共享",
      groups: "学习小组", parent: "家长入口", analytics: "分析", settings: "设置",
      save: "保存", cancel: "取消", delete: "删除", close: "关闭", add: "添加",
      due_today: "今天", due_tomorrow: "明天", overdue: "已逾期",
      empty_generic: "暂无内容", search_placeholder: "搜索或跳转…"
    }
  };

  const NAMES = { en: "English", es: "Español", fr: "Français", zh: "中文" };

  function locale() { return S.settings.locale || "en"; }

  function t(key, fallback) {
    const l = locale();
    return (DICT[l] && DICT[l][key]) || (DICT.en && DICT.en[key]) || fallback || key;
  }

  function available() { return Object.keys(DICT).map((code) => ({ code, name: NAMES[code] || code })); }

  function setLocale(code) {
    if (!DICT[code]) return;
    S.commit((db) => { db.settings.locale = code; });
    // Stamp <html lang> straight away rather than waiting for the next
    // applyShellPrefs; assistive tech reads it at the moment the page
    // changes, not on the next preference save.
    if (App.applyShellPrefs) App.applyShellPrefs();
  }

  // Locale-aware date/number formatting, used anywhere raw Intl calls happen.
  function fmtNumber(n) { return new Intl.NumberFormat(locale()).format(n); }
  function fmtDate(d) { return new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric" }).format(d instanceof Date ? d : new Date(d)); }

  return { t, available, setLocale, locale, fmtNumber, fmtDate, NAMES };
})();

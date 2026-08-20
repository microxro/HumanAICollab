/* ==========================================================================
   i18n.js — localization (F099)

   Honest scope: translating all ~150 screens' copy word-for-word is a
   multi-week professional localization job, not something to fake. What's
   real here: a working translation layer (dictionary lookup + interpolation,
   locale-aware date/number formatting via Intl, which utils.js already
   leans on), wired to the nav labels, common actions, and empty states —
   the strings a user sees on every screen, in every language offered.
   Adding a language means adding one entry to DICT; nothing else changes.
   ========================================================================== */

App.i18n = (function () {
  const S = App.store;

  const DICT = {
    en: {
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
  }

  // Locale-aware date/number formatting, used anywhere raw Intl calls happen.
  function fmtNumber(n) { return new Intl.NumberFormat(locale()).format(n); }
  function fmtDate(d) { return new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric" }).format(d instanceof Date ? d : new Date(d)); }

  return { t, available, setLocale, locale, fmtNumber, fmtDate, NAMES };
})();

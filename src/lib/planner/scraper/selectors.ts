/**
 * CSS selectors for Canvas LMS (Instructure).
 * These target the standard Canvas web UI structure.
 * All selectors are centralized here for easy maintenance
 * when Canvas updates its UI.
 */

export const CANVAS_SELECTORS = {
  // ─── Login page ───
  LOGIN_EMAIL: "#pseudonym_session_unique_id",
  LOGIN_PASSWORD: "#pseudonym_session_password",
  LOGIN_SUBMIT: '.Button--login, button[type="submit"]',
  // CAS/SSO redirect detection
  SSO_FORM: 'form[action*="cas"], form[action*="sso"], form[action*="saml"]',

  // ─── Dashboard ───
  DASHBOARD: "#dashboard",
  COURSE_CARD: ".ic-DashboardCard",
  COURSE_LINK: ".ic-DashboardCard__link",
  COURSE_CODE: ".ic-DashboardCard__header-subtitle",
  COURSE_NAME: ".ic-DashboardCard__header-title",

  // ─── Course navigation ───
  COURSE_NAV: "#section-tabs",
  NAV_LINK_ASSIGNMENTS: 'a.assignments',
  NAV_LINK_SYLLABUS: 'a.syllabus',
  NAV_LINK_MODULES: 'a.modules',

  // ─── Assignments list page ───
  ASSIGNMENT_GROUP: ".assignment-group",
  ASSIGNMENT_ITEM: ".ig-row",
  ASSIGNMENT_TITLE: ".ig-title a",
  ASSIGNMENT_DUE: ".assignment-date-due .screenreader-only, .assignment-date-due",
  ASSIGNMENT_POINTS: ".points_possible",
  ASSIGNMENT_BADGE: ".ig-details .submissionType",

  // ─── Assignment detail page ───
  ASSIGNMENT_DESCRIPTION: ".description.user_content, #assignment_show .description",
  ASSIGNMENT_RUBRIC: "#rubrics .rubric_container",
  ASSIGNMENT_RUBRIC_CRITERIA: ".rubric_criterion .description_title",
  ASSIGNMENT_SUBMISSION_TYPE: ".assignment_submission_types",
  ASSIGNMENT_DUE_DATE: ".date_text",

  // ─── Syllabus page ───
  SYLLABUS_BODY: "#course_syllabus, .syllabus_content",
  SYLLABUS_TABLE: ".ic-Table--condensed, .syllabus_table",
  SYLLABUS_EVENT_ROW: ".syllabus_table tr",

  // ─── Modules page ───
  MODULE_LIST: ".context_module",
  MODULE_TITLE: ".ig-header-title .name, .name.ellipsis",
  MODULE_ITEM: ".ig-row",
  MODULE_ITEM_TITLE: ".ig-title a, .module-item-title",

  // ─── Course homepage ───
  COURSE_HOME_CONTENT: "#course_home_content, .wiki-content",
  COURSE_FRONT_PAGE: ".show-content.user_content",

  // ─── General content ───
  USER_CONTENT: ".user_content",
  LOADING_SPINNER: ".loading_image, .ic-Spinner",
};

/**
 * URL patterns for Canvas page detection.
 */
export const CANVAS_URL_PATTERNS = {
  DASHBOARD: /\/$/,
  COURSE_HOME: /\/courses\/\d+$/,
  ASSIGNMENTS_LIST: /\/courses\/\d+\/assignments$/,
  ASSIGNMENT_DETAIL: /\/courses\/\d+\/assignments\/\d+$/,
  SYLLABUS: /\/courses\/\d+\/assignments\/syllabus$/,
  MODULES: /\/courses\/\d+\/modules$/,
  QUIZZES: /\/courses\/\d+\/quizzes$/,
  LOGIN: /\/login/,
};

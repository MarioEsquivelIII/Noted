import type { EventColor } from "../events";

/** Rotate through these colors when assigning courses */
export const COURSE_COLOR_PALETTE: EventColor[] = [
  "blue",
  "purple",
  "orange",
  "teal",
  "red",
  "pink",
  "green",
  "yellow",
];

/** Canvas API default pagination */
export const CANVAS_PER_PAGE = 100;

/** Rate-limit thresholds */
export const RATE_LIMIT_SLOW_THRESHOLD = 50;   // add 500ms delay
export const RATE_LIMIT_PAUSE_THRESHOLD = 10;   // add 2s delay
export const RATE_LIMIT_MAX_RETRIES = 3;

/** sessionStorage key for Canvas import handoff (mirrors GCAL_IMPORT_KEY pattern) */
export const CANVAS_IMPORT_KEY = "noted_canvas_import";

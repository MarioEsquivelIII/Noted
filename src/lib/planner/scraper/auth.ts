import { chromium, type BrowserContext } from "playwright";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { CANVAS_SELECTORS, CANVAS_URL_PATTERNS } from "./selectors";

const AUTH_DIR = join(process.cwd(), ".canvas-auth");

/**
 * Get the storage state file path for a user.
 */
export function getAuthStatePath(userId: string): string {
  return join(AUTH_DIR, `${userId}.json`);
}

/**
 * Check if a valid auth state file exists for the user.
 */
export function hasValidAuth(userId: string): boolean {
  const path = getAuthStatePath(userId);
  if (!existsSync(path)) return false;

  // Check file age (expire after 24 hours)
  try {
    const { mtimeMs } = statSync(path);
    const ageHours = (Date.now() - mtimeMs) / 3600000;
    return ageHours < 24;
  } catch {
    return false;
  }
}

/**
 * Launch a headed browser for the student to manually log into Canvas.
 * Waits for successful authentication, then saves the storage state.
 *
 * NOTE: This only works in local development (needs a visible browser).
 * In production, a different auth mechanism would be needed.
 */
export async function launchAuthBrowser(
  userId: string,
  canvasDomain: string,
): Promise<{ success: boolean; error?: string }> {
  // Ensure auth directory exists
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false, // student needs to see the browser to log in
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Navigate to Canvas login
    await page.goto(`https://${canvasDomain}/login`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for the student to complete login (including SSO/MFA)
    // Detect successful login by waiting for the dashboard or a course page
    console.log("[Canvas Auth] Waiting for student to complete login...");

    await page.waitForURL(
      (url) => {
        const path = url.pathname;
        return (
          path === "/" ||
          path.startsWith("/courses") ||
          path.startsWith("/dashboard") ||
          CANVAS_URL_PATTERNS.DASHBOARD.test(path)
        );
      },
      { timeout: 300000 }, // 5 minutes to complete login + MFA
    );

    console.log("[Canvas Auth] Login successful, saving state...");

    // Verify we're actually logged in by checking for dashboard content
    try {
      await page.waitForSelector(
        `${CANVAS_SELECTORS.DASHBOARD}, ${CANVAS_SELECTORS.COURSE_CARD}, #global_nav_profile_link`,
        { timeout: 10000 },
      );
    } catch {
      // Might not have dashboard cards but that's ok if URL changed
    }

    // Save storage state (cookies + localStorage)
    const statePath = getAuthStatePath(userId);
    await context.storageState({ path: statePath });

    console.log(`[Canvas Auth] State saved to ${statePath}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Canvas Auth] Failed:", message);
    return { success: false, error: message };
  } finally {
    await browser.close();
  }
}

/**
 * Create a Playwright browser context with saved auth state.
 * Returns null if no valid auth state exists.
 */
export async function createAuthenticatedContext(
  userId: string,
): Promise<BrowserContext | null> {
  if (!hasValidAuth(userId)) return null;

  const statePath = getAuthStatePath(userId);
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  return context;
}

/**
 * Verify that a browser context is still authenticated.
 * Navigates to Canvas and checks if we get redirected to login.
 */
export async function verifyAuth(
  context: BrowserContext,
  canvasDomain: string,
): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(`https://${canvasDomain}/courses`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    const url = page.url();
    return !CANVAS_URL_PATTERNS.LOGIN.test(url);
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

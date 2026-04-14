import { createClient as createSupabaseServer } from "@/utils/supabase/server";
import { encrypt } from "./crypto";
import {
  CANVAS_PER_PAGE,
  RATE_LIMIT_SLOW_THRESHOLD,
  RATE_LIMIT_PAUSE_THRESHOLD,
  RATE_LIMIT_MAX_RETRIES,
} from "./constants";
import type {
  CanvasApiCourse,
  CanvasApiAssignment,
  CanvasApiQuiz,
  CanvasApiDiscussion,
  CanvasApiCalendarEvent,
  CanvasApiPlannerItem,
  CanvasApiPage,
  CanvasApiUserProfile,
} from "./types";

/** Parse the Link header for rel="next" URL */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class CanvasClient {
  private domain: string;
  private accessToken: string;
  private refreshToken: string;
  private userId: string; // Supabase user ID, for persisting refreshed tokens
  private connectionId: string;
  private rateLimitRemaining = 700;

  constructor(
    domain: string,
    accessToken: string,
    refreshToken: string,
    userId: string,
    connectionId: string,
  ) {
    this.domain = domain;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.userId = userId;
    this.connectionId = connectionId;
  }

  private get baseUrl(): string {
    return `https://${this.domain}/api/v1`;
  }

  /** Single request with rate-limit awareness and token refresh */
  private async request<T>(
    path: string,
    options: RequestInit = {},
    retryCount = 0,
  ): Promise<{ data: T; headers: Headers }> {
    // Rate-limit delay
    if (this.rateLimitRemaining < RATE_LIMIT_PAUSE_THRESHOLD) {
      await sleep(2000);
    } else if (this.rateLimitRemaining < RATE_LIMIT_SLOW_THRESHOLD) {
      await sleep(500);
    }

    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Track rate limit
    const remaining = res.headers.get("x-rate-limit-remaining");
    if (remaining) this.rateLimitRemaining = parseFloat(remaining);

    // 401 → try token refresh once
    if (res.status === 401 && retryCount === 0) {
      await this.refreshAccessToken();
      return this.request<T>(path, options, retryCount + 1);
    }

    // 403 rate limit → exponential backoff
    if (res.status === 403 && retryCount < RATE_LIMIT_MAX_RETRIES) {
      const body = await res.text();
      if (body.toLowerCase().includes("rate limit")) {
        await sleep(1000 * Math.pow(2, retryCount));
        return this.request<T>(path, options, retryCount + 1);
      }
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Canvas API ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  }

  /** Fetch all pages following Link: rel="next" */
  private async fetchAllPages<T>(path: string): Promise<T[]> {
    const separator = path.includes("?") ? "&" : "?";
    let url = `${path}${separator}per_page=${CANVAS_PER_PAGE}`;
    const all: T[] = [];

    while (url) {
      const { data, headers } = await this.request<T[]>(url);
      all.push(...data);
      const nextUrl = parseNextLink(headers.get("link"));
      url = nextUrl || "";
    }

    return all;
  }

  /** Refresh the access token using the refresh token */
  private async refreshAccessToken(): Promise<void> {
    const res = await fetch(`https://${this.domain}/login/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.CANVAS_CLIENT_ID || "",
        client_secret: process.env.CANVAS_CLIENT_SECRET || "",
        refresh_token: this.refreshToken,
      }),
    });

    if (!res.ok) {
      throw new Error(`Canvas token refresh failed: ${res.status}`);
    }

    const { access_token, refresh_token } = await res.json();
    this.accessToken = access_token;
    if (refresh_token) this.refreshToken = refresh_token;

    // Persist refreshed tokens to Supabase
    const supabase = await createSupabaseServer();
    await supabase
      .from("canvas_connections")
      .update({
        access_token_encrypted: encrypt(this.accessToken),
        ...(refresh_token ? { refresh_token_encrypted: encrypt(this.refreshToken) } : {}),
      })
      .eq("id", this.connectionId)
      .eq("user_id", this.userId);
  }

  // ─── Public API methods ───

  async getCourses(enrollmentState = "active"): Promise<CanvasApiCourse[]> {
    return this.fetchAllPages<CanvasApiCourse>(
      `/courses?enrollment_state=${enrollmentState}&include[]=term&include[]=syllabus_body`,
    );
  }

  async getAssignments(courseId: string): Promise<CanvasApiAssignment[]> {
    return this.fetchAllPages<CanvasApiAssignment>(
      `/courses/${courseId}/assignments?order_by=due_at`,
    );
  }

  async getQuizzes(courseId: string): Promise<CanvasApiQuiz[]> {
    return this.fetchAllPages<CanvasApiQuiz>(`/courses/${courseId}/quizzes`);
  }

  async getDiscussionTopics(courseId: string): Promise<CanvasApiDiscussion[]> {
    return this.fetchAllPages<CanvasApiDiscussion>(
      `/courses/${courseId}/discussion_topics`,
    );
  }

  async getCalendarEvents(contextCodes: string[]): Promise<CanvasApiCalendarEvent[]> {
    const codes = contextCodes.map((c) => `context_codes[]=${c}`).join("&");
    return this.fetchAllPages<CanvasApiCalendarEvent>(
      `/calendar_events?${codes}&type=event`,
    );
  }

  async getPlannerItems(startDate?: string, endDate?: string): Promise<CanvasApiPlannerItem[]> {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    const qs = params.toString();
    return this.fetchAllPages<CanvasApiPlannerItem>(
      `/planner/items${qs ? `?${qs}` : ""}`,
    );
  }

  async getCourseSyllabus(courseId: string): Promise<string> {
    const { data } = await this.request<CanvasApiCourse>(
      `/courses/${courseId}?include[]=syllabus_body`,
    );
    return data.syllabus_body || "";
  }

  async getCourseFrontPage(courseId: string): Promise<string> {
    try {
      const { data } = await this.request<CanvasApiPage>(
        `/courses/${courseId}/front_page`,
      );
      return data.body || "";
    } catch {
      // Course may not have a front page set
      return "";
    }
  }

  async getUserProfile(): Promise<CanvasApiUserProfile> {
    const { data } = await this.request<CanvasApiUserProfile>("/users/self/profile");
    return data;
  }
}

import {
  Test,
  Submission,
  Protest,
  Question,
  QuestionSet,
  TestConfig,
  UserAnswer,
  Profile,
  ProfileMe,
  ContributionsCalendar,
  AdminUserRow,
} from "@/types";
import { supabase } from "./supabase";

/**
 * If NEXT_PUBLIC_API_URL is unset/empty, the browser calls same-origin `/backend-api/*`
 * and Next.js rewrites to FastAPI (see next.config.js). That avoids CORS and fixes many
 * Windows cases where `localhost:8000` resolves to IPv6 while uvicorn listens on IPv4 only.
 */
const rawApi = process.env.NEXT_PUBLIC_API_URL;
const API_DIRECT =
  rawApi != null && String(rawApi).trim() !== ""
    ? String(rawApi).trim().replace(/\/$/, "")
    : null;
const API_BASE = API_DIRECT ?? "/backend-api";

function requestUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token || "";
}

function networkErrorHint(): string {
  if (API_DIRECT) {
    return (
      `Could not reach the API at ${API_DIRECT}. Start FastAPI (uvicorn). ` +
      "If you use `localhost` here on Windows, try `http://127.0.0.1:8000` or remove NEXT_PUBLIC_API_URL " +
      "from .env.local to use the built-in `/backend-api` proxy (see README)."
    );
  }
  return (
    "Could not reach the API through the Next.js proxy. Start FastAPI on 127.0.0.1:8000 " +
    "(e.g. `uvicorn main:app --reload --port 8000`). If it runs elsewhere, set BACKEND_PROXY_TARGET when starting `next dev`."
  );
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(requestUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Failed to fetch" || e instanceof TypeError) {
      throw new Error(`${msg}. ${networkErrorHint()}`);
    }
    throw e;
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = error.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.join("; ")
          : detail != null
            ? JSON.stringify(detail)
            : res.statusText;
    throw new Error(msg || "API request failed");
  }

  return res.json();
}

export const api = {
  auth: {
    me() {
      return apiFetch<Profile>("/auth/me");
    },
  },

  profile: {
    me() {
      return apiFetch<ProfileMe>("/profile/me");
    },
    patch(body: {
      username?: string | null;
      bio?: string | null;
      avatar_url?: string | null;
      equipped_theme?: string | null;
      equipped_frame?: string | null;
    }) {
      return apiFetch<ProfileMe>("/profile/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    contributions() {
      return apiFetch<ContributionsCalendar>("/profile/me/contributions");
    },
  },

  questions: {
    list(params?: {
      subject?: string;
      difficulty?: string;
      course_level?: string;
      grade_level?: number;
      type?: string;
    }) {
      const query = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "") {
            query.set(k, String(v));
          }
        });
      }
      return apiFetch<Question[]>(`/questions?${query}`);
    },
    create(data: Partial<Question>) {
      return apiFetch<Question>("/questions", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    myBank() {
      return apiFetch<Question[]>("/questions/my-bank");
    },
    moderationQueue() {
      return apiFetch<Question[]>("/questions/moderation-queue");
    },
    communityBank() {
      return apiFetch<Question[]>("/questions/community-bank");
    },
    rejectionReasons() {
      return apiFetch<{ id: string; label: string }[]>("/questions/rejection-reasons");
    },
    get(id: string) {
      return apiFetch<Question>(`/questions/${id}`);
    },
    update(id: string, data: Record<string, unknown>) {
      return apiFetch<Question>(`/questions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return apiFetch<{ status: string; id: string }>(`/questions/${id}`, {
        method: "DELETE",
      });
    },
    submitForReview(id: string) {
      return apiFetch<Question>(`/questions/${id}/submit-for-review`, {
        method: "POST",
      });
    },
    approve(id: string) {
      return apiFetch<Question>(`/questions/${id}/approve`, { method: "POST" });
    },
    reject(id: string, body: { reason: string; explanation?: string }) {
      return apiFetch<Question>(`/questions/${id}/reject`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },

  admin: {
    listUsers() {
      return apiFetch<AdminUserRow[]>("/admin/users");
    },
    updateUser(
      id: string,
      body: { username?: string | null; role?: string }
    ) {
      return apiFetch<AdminUserRow>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    deleteUser(id: string) {
      return apiFetch<{ status: string; id: string }>(`/admin/users/${id}`, {
        method: "DELETE",
      });
    },
  },

  questionSets: {
    create(data: { context_text: string; context_image_url?: string }) {
      return apiFetch<QuestionSet>("/question-sets", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    get(setId: string) {
      return apiFetch<QuestionSet>(`/question-sets/${setId}`);
    },
    list() {
      return apiFetch<QuestionSet[]>("/question-sets");
    },
    addQuestion(setId: string, data: Partial<Question>) {
      return apiFetch<Question>(`/question-sets/${setId}/questions`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    delete(setId: string) {
      return apiFetch<{ status: string }>(`/question-sets/${setId}`, {
        method: "DELETE",
      });
    },
  },

  tests: {
    generate(config: TestConfig) {
      return apiFetch<Test>("/tests/generate", {
        method: "POST",
        body: JSON.stringify(config),
      });
    },
    get(testId: string) {
      return apiFetch<Test>(`/tests/${testId}`);
    },
    start(testId: string) {
      return apiFetch<{ status: string }>(`/tests/${testId}/start`, {
        method: "POST",
      });
    },
  },

  submissions: {
    submit(testId: string, answers: UserAnswer[]) {
      return apiFetch<Submission[]>("/submissions/submit", {
        method: "POST",
        body: JSON.stringify({ test_id: testId, answers }),
      });
    },
    getForTest(testId: string) {
      return apiFetch<Submission[]>(`/submissions/test/${testId}`);
    },
    requestGrade(submissionId: string) {
      return apiFetch<{ status: string }>("/submissions/grade", {
        method: "POST",
        body: JSON.stringify({ submission_id: submissionId }),
      });
    },
  },

  protests: {
    create(submissionId: string, argument: string) {
      return apiFetch<Protest>("/protests", {
        method: "POST",
        body: JSON.stringify({
          submission_id: submissionId,
          user_argument: argument,
        }),
      });
    },
    getForSubmission(submissionId: string) {
      return apiFetch<Protest[]>(`/protests/submission/${submissionId}`);
    },
  },
};

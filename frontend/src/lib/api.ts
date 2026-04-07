import {
  Test,
  Submission,
  Protest,
  Question,
  QuestionSet,
  Subject,
  TestConfig,
  UserAnswer,
  Profile,
  ProfileMe,
  ContributionsCalendar,
  AdminUserRow,
  ExtractionAnalyzeResponse,
  ExtractionCommitBody,
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

/** Hosted APIs (e.g. Render free tier) often sleep; first requests fail until the instance wakes (~30–90s). */
function isLikelyColdStartHost(): boolean {
  if (!API_DIRECT) return false;
  return /onrender\.com|render\.com/i.test(API_DIRECT);
}

function requestUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return msg === "Failed to fetch" || msg.includes("Failed to fetch");
}

function isPdfFile(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

/** Wall-clock budget for full extraction stream (upload + N vision calls + merge). */
export function extractionTimeoutMs(files: File[], maxPages: number): number {
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const mb = totalBytes / (1024 * 1024);
  const nPages =
    files.length === 1 && isPdfFile(files[0])
      ? maxPages
      : Math.min(files.length, maxPages);
  const base = 90_000;
  const perPage = 55_000;
  const perMb = 12_000;
  const cap = 50 * 60 * 1000;
  return Math.min(cap, Math.max(150_000, base + nPages * perPage + mb * perMb));
}

/**
 * When the user disables the client-side extraction timeout, we still arm a very long idle timer
 * so a hung tab does not run forever. Browsers typically clamp setTimeout (~24.8 days max).
 */
const EXTRACTION_DISABLED_TIMEOUT_IDLE_MS = 2_147_483_647;

/**
 * While reading the NDJSON body: extend the deadline on each chunk (merge / huge `result` JSON
 * can leave the stream quiet for a long time; proxies may drop idle connections — server sends
 * `status` heartbeats too). Does not run during upload (use a separate timeout on `fetch`).
 *
 * @param wallDeadlineAt - If null, no wall-clock abort while reading (only idleMs applies).
 */
function createStreamReadAbort(wallDeadlineAt: number | null, idleMs: number) {
  const ctrl = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdle = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const bump = () => {
    clearIdle();
    idleTimer = setTimeout(() => ctrl.abort(), idleMs);
  };
  bump();
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  if (wallDeadlineAt != null) {
    totalTimer = setTimeout(
      () => ctrl.abort(),
      Math.max(30_000, wallDeadlineAt - performance.now())
    );
  }
  const dispose = () => {
    clearIdle();
    if (totalTimer !== undefined) {
      clearTimeout(totalTimer);
    }
  };
  return { signal: ctrl.signal, bump, dispose };
}

function isLikelyTimeoutAbort(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "TimeoutError") return true;
  return false;
}

function buildExtractionFormData(
  files: File[],
  opts?: {
    max_pages?: number;
    dpi?: number;
    high_accuracy?: boolean;
    two_stage?: boolean;
    layout_only?: boolean;
  }
): FormData {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", f);
  }
  if (opts?.max_pages != null) fd.append("max_pages", String(opts.max_pages));
  if (opts?.dpi != null) fd.append("dpi", String(opts.dpi));
  fd.append("high_accuracy", opts?.high_accuracy ? "true" : "false");
  fd.append("two_stage", opts?.two_stage ? "true" : "false");
  fd.append("layout_only", opts?.layout_only ? "true" : "false");
  return fd;
}

/**
 * Wake a sleeping host (no auth). Skipped for same-origin proxy in dev.
 */
async function warmupBackendIfRemote(): Promise<void> {
  if (!API_DIRECT) return;
  if (!isLikelyColdStartHost()) return;
  const url = requestUrl("/health");
  const delays = [0, 2000, 5000, 10000];
  let last: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      last = new Error(`Health check returned ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
}

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token || "";
}

function networkErrorHint(): string {
  const renderNote = isLikelyColdStartHost()
    ? " If the API is on Render, free/starter instances sleep after idle time: the first requests often fail until the " +
      "service wakes (often 30–90s). Wait and retry, use a plan without sleep, or ping `/health` on an interval to keep it warm."
    : "";

  if (API_DIRECT) {
    return (
      `Could not reach the API at ${API_DIRECT}. Start FastAPI (uvicorn) or wait for the host to respond. ` +
      "If you use `localhost` here on Windows, try `http://127.0.0.1:8000` or remove NEXT_PUBLIC_API_URL " +
      "from .env.local to use the built-in `/backend-api` proxy (see README)." +
      renderNote
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
  const method = (options.method ?? "GET").toUpperCase();
  /** Retrying POST can duplicate side effects; only retry safe reads. */
  const maxAttempts =
    method === "GET" || method === "HEAD" ? (isLikelyColdStartHost() ? 4 : 2) : 1;

  let res: Response | undefined;
  let lastNet: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(1200 * Math.pow(2, attempt - 1));
    }
    try {
      res = await fetch(requestUrl(path), {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });
      lastNet = undefined;
      break;
    } catch (e) {
      lastNet = e;
      if (!isNetworkFailure(e) || attempt === maxAttempts - 1) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isNetworkFailure(e)) {
          throw new Error(`${msg}. ${networkErrorHint()}`);
        }
        throw e;
      }
    }
  }

  if (!res) {
    const msg = lastNet instanceof Error ? lastNet.message : String(lastNet ?? "unknown");
    throw new Error(`${msg}. ${networkErrorHint()}`);
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = error.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((d: unknown) =>
                typeof d === "string" ? d : typeof d === "object" && d !== null && "msg" in d ? (d as { msg: string }).msg : JSON.stringify(d)
              )
              .join("; ")
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

  subjects: {
    list() {
      return apiFetch<Subject[]>("/subjects");
    },
    create(data: { name: string; levels: string[]; position?: number }) {
      return apiFetch<Subject>("/subjects", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: { name?: string; levels?: string[]; position?: number }) {
      return apiFetch<Subject>(`/subjects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return apiFetch<{ status: string; id: string }>(`/subjects/${id}`, {
        method: "DELETE",
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

  extraction: {
    /**
     * Streams NDJSON from ``/extraction/analyze-stream`` so the UI can show per-page progress.
     */
    async analyze(
      files: File[],
      opts?: {
        max_pages?: number;
        dpi?: number;
        high_accuracy?: boolean;
        two_stage?: boolean;
        /** Layout scan only (bounding boxes); no full text/structure extraction. */
        layout_only?: boolean;
        /** If true, do not cap upload + stream read by the usual client wall clock (host/network may still limit). */
        disableClientTimeout?: boolean;
        onProgress?: (completed: number, total: number) => void;
      }
    ): Promise<ExtractionAnalyzeResponse> {
      const token = await getToken();
      const maxPages = opts?.max_pages ?? 24;
      const noClientTimeout = opts?.disableClientTimeout === true;

      /** Cheap GET before large upload — reduces “Failed to fetch” when Render is asleep. */
      if (isLikelyColdStartHost()) {
        try {
          await warmupBackendIfRemote();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `API did not respond to /health after several attempts (${msg}). ${networkErrorHint()}`
          );
        }
      }

      const streamAttempts = isLikelyColdStartHost() ? 3 : 2;
      const maxTotalMs = extractionTimeoutMs(files, maxPages);
      let res: Response | undefined;
      let streamStartedAt = performance.now();
      for (let a = 0; a < streamAttempts; a++) {
        if (a > 0) {
          await sleep(2000 * a);
        }
        const fd = buildExtractionFormData(files, {
          max_pages: maxPages,
          dpi: opts?.dpi,
          high_accuracy: opts?.high_accuracy,
          two_stage: opts?.two_stage,
          layout_only: opts?.layout_only,
        });
        streamStartedAt = performance.now();
        const fetchInit: RequestInit = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        };
        if (!noClientTimeout) {
          fetchInit.signal = AbortSignal.timeout(maxTotalMs);
        }
        try {
          res = await fetch(requestUrl("/extraction/analyze-stream"), fetchInit);
          break;
        } catch (e) {
          if (!noClientTimeout && isLikelyTimeoutAbort(e)) {
            throw new Error(
              "Extraction timed out. Try fewer pages, lower “max pages”, enable “No browser time limit”, or enable direct API URL (see README)."
            );
          }
          if (!isNetworkFailure(e) || a === streamAttempts - 1) {
            const msg = e instanceof Error ? e.message : String(e);
            if (isNetworkFailure(e)) {
              throw new Error(`${msg}. ${networkErrorHint()}`);
            }
            throw e;
          }
        }
      }
      if (!res) {
        throw new Error(`Failed to start extraction. ${networkErrorHint()}`);
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        const detail = error.detail;
        const msg =
          typeof detail === "string"
            ? detail
            : detail != null
              ? JSON.stringify(detail)
              : res.statusText;
        throw new Error(msg || "API request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body from extraction stream.");
      }

      const readWallDeadline = noClientTimeout ? null : streamStartedAt + maxTotalMs;
      const readIdleMs = noClientTimeout
        ? EXTRACTION_DISABLED_TIMEOUT_IDLE_MS
        : 15 * 60 * 1000;
      const readCtrl = createStreamReadAbort(readWallDeadline, readIdleMs);
      const onReadAbort = () => {
        reader.cancel().catch(() => {});
      };
      readCtrl.signal.addEventListener("abort", onReadAbort);

      const decoder = new TextDecoder();
      let buffer = "";
      let result: ExtractionAnalyzeResponse | null = null;
      const pageImages = new Map<
        number,
        { image_base64: string; width_px: number; height_px: number }
      >();
      const pageImageAssembly = new Map<
        number,
        {
          width_px: number;
          height_px: number;
          format: string;
          parts: Map<number, string>;
        }
      >();
      let resultB64Parts: string[] = [];
      let sawProgress = false;
      let lastTotal = 0;

      const flushLine = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let ev: {
          type: string;
          completed?: number;
          total?: number;
          parts?: number;
          data?: ExtractionAnalyzeResponse | string | Record<string, unknown>;
          detail?: string;
        };
        try {
          ev = JSON.parse(t) as typeof ev;
        } catch {
          throw new Error(
            "Malformed extraction stream (JSON parse error). The response was likely truncated — try fewer pages, lower max pages, or set NEXT_PUBLIC_API_URL to your API host."
          );
        }
        if (ev.type === "error") {
          throw new Error(ev.detail || "Extraction failed.");
        }
        if (ev.type === "status") {
          return;
        }
        if (ev.type === "page_image_begin" && ev.data && typeof ev.data === "object") {
          const d = ev.data as Record<string, unknown>;
          const idx = d.page_index;
          const w = d.width_px;
          const h = d.height_px;
          const fmt = typeof d.format === "string" ? d.format : "png";
          if (
            typeof idx === "number" &&
            typeof w === "number" &&
            typeof h === "number"
          ) {
            pageImageAssembly.set(idx, {
              width_px: Math.round(w),
              height_px: Math.round(h),
              format: fmt,
              parts: new Map(),
            });
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "page_image_part" && ev.data && typeof ev.data === "object") {
          const d = ev.data as Record<string, unknown>;
          const idx = d.page_index;
          const part = d.part;
          const b64p = d.b64;
          if (
            typeof idx === "number" &&
            typeof part === "number" &&
            typeof b64p === "string"
          ) {
            const asm = pageImageAssembly.get(idx);
            if (asm) asm.parts.set(part, b64p);
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "page_image_end" && ev.data && typeof ev.data === "object") {
          const d = ev.data as Record<string, unknown>;
          const idx = d.page_index;
          if (typeof idx === "number") {
            const asm = pageImageAssembly.get(idx);
            pageImageAssembly.delete(idx);
            if (asm) {
              const ordered = [...asm.parts.keys()]
                .sort((a, b) => a - b)
                .map((k) => asm.parts.get(k) ?? "");
              const raw = ordered.join("");
              const isJpeg = asm.format === "jpeg";
              const image_base64 =
                isJpeg && raw && !raw.startsWith("data:")
                  ? `data:image/jpeg;base64,${raw}`
                  : raw;
              pageImages.set(idx, {
                image_base64,
                width_px: asm.width_px,
                height_px: asm.height_px,
              });
            }
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "page_image" && ev.data && typeof ev.data === "object") {
          const d = ev.data as Record<string, unknown>;
          const idx = d.page_index;
          const b64 = d.image_base64;
          const w = d.width_px;
          const h = d.height_px;
          const fmt = typeof d.format === "string" ? d.format : "png";
          if (
            typeof idx === "number" &&
            typeof b64 === "string" &&
            typeof w === "number" &&
            typeof h === "number"
          ) {
            const isJpeg = fmt === "jpeg";
            const image_base64 =
              isJpeg && b64 && !b64.startsWith("data:")
                ? `data:image/jpeg;base64,${b64}`
                : b64;
            pageImages.set(idx, {
              image_base64,
              width_px: Math.round(w),
              height_px: Math.round(h),
            });
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "result_b64_begin") {
          resultB64Parts = [];
          readCtrl.bump();
          return;
        }
        if (ev.type === "result_b64_part") {
          const frag = ev.data;
          if (typeof frag === "string") {
            resultB64Parts.push(frag);
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "result_b64_end") {
          const joined = resultB64Parts.join("");
          resultB64Parts = [];
          try {
            const binary = atob(joined);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const text = new TextDecoder().decode(bytes);
            result = JSON.parse(text) as ExtractionAnalyzeResponse;
          } catch {
            throw new Error(
              "Malformed extraction stream (failed to decode sharded result). Try fewer pages or contact support."
            );
          }
          readCtrl.bump();
          return;
        }
        if (ev.type === "progress") {
          sawProgress = true;
          if (typeof ev.total === "number") lastTotal = ev.total;
          if (
            opts?.onProgress &&
            typeof ev.completed === "number" &&
            typeof ev.total === "number"
          ) {
            opts.onProgress(ev.completed, ev.total);
          }
        }
        if (ev.type === "result" && ev.data) {
          result = ev.data as ExtractionAnalyzeResponse;
        }
      };

      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (e) {
            if (isLikelyTimeoutAbort(e)) {
              throw new Error(
                noClientTimeout
                  ? "Extraction stopped after a very long period with no data from the server. The connection or host may have closed; try again or check your API / proxy limits."
                  : "Extraction timed out while reading the stream. For large PDFs enable “No browser time limit”, reduce max pages, or host the API with longer proxy timeouts."
              );
            }
            const msg = e instanceof Error ? e.message : String(e);
            const tail = isLikelyColdStartHost()
              ? " Hosted APIs sometimes close long streams (idle sleep, or HTTP/proxy time limits)."
              : "";
            throw new Error(`Extraction stream interrupted: ${msg}.${tail}`);
          }
          const { done, value } = chunk;
          if (done) break;
          readCtrl.bump();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            flushLine(line);
          }
        }
        if (buffer.trim()) {
          flushLine(buffer);
        }
      } finally {
        readCtrl.signal.removeEventListener("abort", onReadAbort);
        readCtrl.dispose();
      }

      if (pageImageAssembly.size > 0) {
        throw new Error(
          "Extraction stream ended before all page image chunks arrived. Try again or reduce page count."
        );
      }

      if (!result) {
        const hint =
          sawProgress && lastTotal > 0
            ? ` The server processed ${lastTotal} page(s) but the final payload never arrived (often a proxy or size limit). Try NEXT_PUBLIC_API_URL pointing at the API, fewer pages, or lower render quality.`
            : " Try again with a smaller file, fewer pages, or direct API URL (see README).";
        throw new Error(`Extraction finished without a result payload.${hint}`);
      }
      const extractionResult: ExtractionAnalyzeResponse = result;
      if (pageImages.size > 0) {
        return {
          warnings: extractionResult.warnings,
          sets: extractionResult.sets,
          pages: extractionResult.pages.map((p) => {
            const img = pageImages.get(p.page_index);
            if (!img) return p;
            return {
              ...p,
              image_base64: img.image_base64,
              width_px: img.width_px,
              height_px: img.height_px,
            };
          }),
        };
      }
      return extractionResult;
    },

    async reanalyzePage(
      file: File,
      opts?: {
        dpi?: number;
        high_accuracy?: boolean;
        two_stage?: boolean;
        layout_only?: boolean;
      }
    ): Promise<ExtractionAnalyzeResponse> {
      const token = await getToken();
      const fd = new FormData();
      fd.append("file", file);
      if (opts?.dpi != null) fd.append("dpi", String(opts.dpi));
      fd.append("high_accuracy", opts?.high_accuracy ? "true" : "false");
      fd.append("two_stage", opts?.two_stage ? "true" : "false");
      fd.append("layout_only", opts?.layout_only ? "true" : "false");
      const signal = AbortSignal.timeout(extractionTimeoutMs([file], 1));
      let res: Response;
      try {
        res = await fetch(requestUrl("/extraction/reanalyze-page"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
          signal,
        });
      } catch (e) {
        if (isLikelyTimeoutAbort(e)) {
          throw new Error("Re-analyze timed out. Try turning off two-stage or use a smaller page image.");
        }
        throw e;
      }
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        const detail = error.detail;
        const msg =
          typeof detail === "string"
            ? detail
            : detail != null
              ? JSON.stringify(detail)
              : res.statusText;
        throw new Error(msg || "Re-analyze failed");
      }
      return res.json() as Promise<ExtractionAnalyzeResponse>;
    },

    commit(body: ExtractionCommitBody) {
      return apiFetch<{ created_set_ids: string[]; question_counts: number[] }>(
        "/extraction/commit",
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
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

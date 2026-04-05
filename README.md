# CramAcademy

AI-powered exam and review platform with Bluebook-style testing, LaTeX support, AI grading, and grade appeals.

## Architecture

```
CramAcademy/
├── frontend/          Next.js 15 (App Router) + Tailwind CSS
├── backend/           FastAPI (Python)
├── database/          PostgreSQL schema (Supabase)
└── README.md
```

### Tech Stack

| Layer          | Technology                          |
| -------------- | ----------------------------------- |
| Frontend       | Next.js 15, React 19, Tailwind CSS  |
| Backend API    | FastAPI, Pydantic v2                |
| Database       | PostgreSQL via Supabase             |
| Auth           | Supabase Auth                       |
| LaTeX          | KaTeX                               |
| AI Grading     | OpenAI-compatible (302.ai / Ollama) |

---

## Features

- **Dynamic Test Generation** — filter by subject, course level (S / S+ / H / H+), grade (6–12), question pool (personal only, community only, or mixed), and count. When using **mixed** pools, the backend deduplicates by question ID so the same question never appears twice.
- **Images** — optional question figure and per-choice images for MCQs (Supabase Storage)
- **PDF / multi-image import** — upload a multi-page **PDF** or select **multiple images** (each file is one “page”). Draw color-coded regions for the question stem and (for MCQs) choices A–D; crops upload as PNGs. Region colors distinguish stem vs. A/B/C/D without on-canvas text labels. Uses the pdf.js worker from `unpkg.com` for PDFs (needs network access in dev/build).
- **AI document extraction** — Dashboard → Contribute → **AI extract**: server renders PDF pages (or uses uploaded images), runs a **vision** model with structured JSON, shows color-coded region overlays and consistency warnings, then commits approved sets to your personal bank via `POST /extraction/commit`. Requires the same **OpenAI-compatible** API as grading (`gpt-4o`-class). Set `EXTRACTION_ENABLED=false` to disable. Uses **`pypdfium2`** + **Pillow** on the backend.
- **Question creation — LaTeX** — text fields that support `$...$` (stem, options, answers, captions, model answers) can show a **hover preview** of rendered math while you type.
- **MCQ explanations** — optional **text** (LaTeX-capable) and/or **image** explanation per MCQ, shown on test results after grading. Older questions without an explanation are flagged in **My question bank**, **moderation queue**, and **community bank** with an orange “missing explanation” indicator (hover for tooltip).
- **Bluebook-Style UI** — fullscreen, distraction-free testing with timer and question grid. **Previous** is hidden on the first question; **Next** is replaced by **Submit Test** on the last question (the top bar still offers Submit at any time).
- **Test results** — total score, **percentage to two decimal places** (based on graded items), and per-question feedback.
- **LaTeX Editor** — live two-panel rendering with KaTeX (FRQ answers when LaTeX is enabled)
- **AI Grading** — rubric-based FRQ evaluation with structured JSON feedback
- **Grade Appeals** — protest system with AI re-evaluation
- **Roles** — `user` (default), `moderator` (validate/edit/delete questions), `admin` (same + manage accounts)
- **Personal question bank** — new contributions stay private until you submit them for review. After a moderator **publishes** a question to the community pool, it **remains listed** in your bank as “Published” (it is no longer only “personal,” but you still see it alongside personal and pending items).
- **Moderation** — review queue; **community bank** subpage to browse or remove published questions; **reject** with a fixed list of reasons. Choosing **Other** requires a **free-text explanation** (stored with the rejection reason for the author).
- **Profiles & gamification** — account page with avatar, editable **username** (shown in the header and profile), bio, contribution heatmap, points, titles, and cosmetic themes/frames (see app).
- **User-Generated Questions** — submit questions and earn contribution points when moderators approve community submissions
- **MCQ + FRQ** — supports both multiple choice and free response

---

## Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **Supabase** account (free tier works)
- **302.ai** API key (or local Ollama instance)

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `database/schema.sql` (new projects). If you already ran an older schema, apply any pending migrations in order, including:
   - **`database/migration_images_levels.sql`** — images / levels / storage
   - **`database/migration_roles_question_pool.sql`** — roles, personal/community pools, RLS
   - **`database/migration_profile_contributions.sql`** — profiles (bio, points, cosmetics), contribution grants, `rejection_reason` on questions (if not already in schema)
   - **`database/migration_explanations.sql`** — MCQ **`explanation`** and **`explanation_image_url`** columns on `questions`
   - **`database/migration_username_avatar.sql`** — `username` (unique) and `avatar_url` on `profiles` (if not already in `schema.sql`)
   - **`database/migration_drop_display_name.sql`** — drops legacy **`display_name`** if you still have it (the app uses **username** only)
   - **`database/migration_drop_difficulty.sql`** — removes **`difficulty`** from **`questions`** and **`tests`** (and enum **`difficulty_level`**) to match the current app
   If question submit fails with **PGRST204** / missing **`question_image_url`**, run **`database/patch_questions_app_columns.sql`** (idempotent). For existing DBs, apply only migrations you have not run yet; **`database/schema.sql`** is the full reference for a fresh Supabase project.
3. Copy your project URL, anon key, and service role key
4. After you create the first account (signup in the app), make an admin with: `UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';` Later admins can use the **Admin** page in the dashboard.

Question images upload to the **`question-images`** bucket. If uploads fail with **Bucket not found**, run **`database/storage_bucket_question_images.sql`** in the Supabase SQL Editor, or create a **public** bucket named exactly **`question-images`** in **Storage → New bucket**, then run that SQL file for the policies.

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env with your Supabase + AI credentials

uvicorn main:app --reload --port 8000
```

The API listens on **127.0.0.1:8000** by default (same as `http://localhost:8000` when IPv4 wins). Docs at `/docs`.

If the browser cannot reach `http://localhost:8000` (common on Windows when `localhost` maps to IPv6 first), either start with `--host 127.0.0.1` explicitly or rely on the frontend **proxy** below instead of `NEXT_PUBLIC_API_URL`.

### 3. Frontend

```bash
cd frontend
npm install

cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials

npm run dev
```

The app will be available at `http://localhost:3000`.

**API calls in local dev:** If you do **not** set `NEXT_PUBLIC_API_URL`, the app requests `/backend-api/...` on the same host as Next.js; `next.config.js` proxies those to `http://127.0.0.1:8000` (override with `BACKEND_PROXY_TARGET`). That avoids CORS entirely and sidesteps `localhost` → IPv6 issues. Set `NEXT_PUBLIC_API_URL` only when the browser must talk to a remote API (e.g. production).

**Still seeing “Failed to fetch”?** Confirm `uvicorn` is running, then restart `npm run dev` after changing `next.config.js` or env. Remove `NEXT_PUBLIC_API_URL=http://localhost:8000` from `.env.local` if you still use it so the proxy is used.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable                     | Description                              |
| ---------------------------- | ---------------------------------------- |
| `SUPABASE_URL`               | Supabase project URL                     |
| `SUPABASE_ANON_KEY`          | Supabase anonymous (public) key          |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service role key (admin)        |
| `SUPABASE_JWT_SECRET`        | **Recommended.** JWT Secret from Project Settings → API. Verifies user tokens locally so the backend does not call `GET /auth/v1/user` (fixes random `AuthRetryableError` / disconnects on Windows). |
| `AI_PROVIDER`                | `302ai` (default) or `ollama`            |
| `OPENAI_API_KEY`             | 302.ai API key                           |
| `OPENAI_BASE_URL`            | `https://api.302.ai/v1`                  |
| `OPENAI_MODEL`               | `gpt-4o` (default)                       |
| `OLLAMA_BASE_URL`            | `http://localhost:11434`                 |
| `OLLAMA_MODEL`               | `llama3` (default)                       |
| `CORS_ORIGINS`               | JSON array of allowed browser origins; include both `http://localhost:3000` and `http://127.0.0.1:3000` if you switch hosts. Missing origin causes **Failed to fetch** on API calls. |
| `EXTRACTION_ENABLED`         | Optional. Default `true`. Set `false` to turn off **`/extraction/*`** (e.g. prod without vision keys). |
| `EXTRACTION_MAX_PAGES`       | Optional. Cap pages per analyze job (default **24**). |
| `EXTRACTION_MAX_IMAGE_EDGE_PX` | Optional. Longest edge for rendered page images before vision (default **1600**). |
| `EXTRACTION_PAGE_CONCURRENCY` | Optional. Parallel vision calls per job (default **4**). |

### Frontend (`frontend/.env.local`)

| Variable                        | Description                     |
| ------------------------------- | ------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key          |
| `NEXT_PUBLIC_SITE_URL`          | Optional. **Canonical site URL** (no trailing slash), e.g. `https://cram-academy.vercel.app`. Used for **email confirmation** redirects on signup. If unset, the browser uses `window.location.origin` (fine when users sign up on the same host). Set on Vercel if links must always point at production. |
| `NEXT_PUBLIC_API_URL`           | Optional. Omit locally to use `/backend-api` proxy to FastAPI. Set for production (full URL, no trailing slash). |

**Supabase email confirmation:** In **Authentication → URL configuration**, set **Site URL** to your production app (e.g. `https://cram-academy.vercel.app`) and add **Redirect URLs** including `https://cram-academy.vercel.app/login` and `http://localhost:3000/login` so `emailRedirectTo` from signup is allowed.

**Supabase project alignment:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the frontend must refer to the **same** Supabase project as `SUPABASE_URL` / keys in the backend. If they differ, sign-in can succeed while API calls return **401 Invalid token**.

---

## API Endpoints

| Method | Path                              | Description                |
| ------ | --------------------------------- | -------------------------- |
| POST   | `/auth/signup`                    | Create account             |
| POST   | `/auth/login`                     | Sign in                    |
| GET    | `/auth/me`                        | Current profile + role     |
| GET    | `/profile/me`                     | Full profile + title/level/points (auth) |
| PATCH  | `/profile/me`                     | Update username, bio, avatar, cosmetics |
| GET    | `/profile/me/contributions`       | Contribution calendar (heatmap data) |
| GET    | `/admin/users`                    | List users (admin)         |
| PATCH  | `/admin/users/{id}`               | Update profile role/name (admin) |
| DELETE | `/admin/users/{id}`               | Delete auth user (admin)   |
| GET    | `/questions`                      | List published community questions |
| GET    | `/questions/my-bank`              | All questions you created (personal, pending, published community) |
| GET    | `/questions/moderation-queue`     | Pending review (mod/admin) |
| GET    | `/questions/community-bank`     | Published community questions (mod/admin) |
| GET    | `/questions/rejection-reasons`    | Fixed list of reject reason IDs/labels (for moderation UI) |
| POST   | `/questions`                      | Create in personal bank    |
| GET    | `/questions/{id}`                 | Get one (if allowed)       |
| PATCH  | `/questions/{id}`                 | Edit (owner personal / staff) |
| DELETE | `/questions/{id}`                 | Delete (rules per role)    |
| POST   | `/questions/{id}/submit-for-review` | Send personal → moderation |
| POST   | `/questions/{id}/approve`        | Publish (mod/admin)        |
| POST   | `/questions/{id}/reject`         | Return to author’s bank; body `{ "reason": "<id>", "explanation"?: "..." }` — **`explanation` required** when `reason` is `other` |
| POST   | `/tests/generate`                 | Generate a test            |
| GET    | `/tests/{id}`                     | Get test with questions    |
| POST   | `/tests/{id}/start`               | Start test timer           |
| POST   | `/submissions/submit`             | Submit all answers         |
| GET    | `/submissions/test/{test_id}`     | Get submissions for a test |
| POST   | `/submissions/grade`              | Request AI re-grade        |
| POST   | `/protests`                       | File a grade appeal        |
| GET    | `/protests/submission/{id}`       | Get protests for submission|
| GET    | `/health`                         | Health check               |
| POST   | `/extraction/analyze`             | Multipart `files[]` + optional `max_pages`, `dpi` — vision extraction draft (auth) |
| POST   | `/extraction/commit`              | JSON body — create question sets + questions in personal bank (auth) |

---

## Deployment

### Frontend → Vercel

1. Push your repo to GitHub
2. Import into [vercel.com](https://vercel.com)
3. Set root directory to `frontend`
4. Add environment variables from `.env.local.example`

### Backend → Render

1. Create a new **Web Service** on [render.com](https://render.com)
2. Set root directory to `backend`
3. **Python version (important):** Render does **not** use `runtime.txt` (that is a Heroku convention). Use one of these ([Render: Python version](https://render.com/docs/python-version)):
   - **Recommended:** In the dashboard → **Environment** → **Environment Variables**, add **`PYTHON_VERSION`** = **`3.12.8`** (must be a full `x.y.z` version). This has the highest precedence and fixes **`pydantic-core`** trying to build from source on Python 3.14 (Rust/maturin + read-only Cargo error).
   - **Also:** `backend/.python-version` exists with `3.12.8` (single line, no `python-` prefix). With **Root Directory** = `backend`, this file must live **inside** `backend/` so the build can see it.
   - Optional: repo root `render.yaml` includes `PYTHON_VERSION` if you use a [Blueprint](https://render.com/docs/infrastructure-as-code).

4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables from `.env.example`

### Database → Supabase

Already hosted. Just keep your project active on the free tier.

---

## AI Grading

The AI grading system uses a rubric-based prompt with:
- Low temperature (0.1) for deterministic output
- Forced JSON response format
- LaTeX-aware math evaluation
- Explicit rubric criteria matching

Two modes:
1. **302.ai** (default) — uses OpenAI-compatible API via 302.ai proxy
2. **Ollama** (fallback) — local model for offline/free usage

The protest system re-grades with a stricter evaluation prompt that considers the student's argument.

---

## License

MIT

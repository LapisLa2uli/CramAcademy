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

- **Dynamic Test Generation** — filter by subject, course level (S / S+ / H / H+), grade (6–12), difficulty, and count
- **Images** — optional question figure and per-choice images for MCQs (Supabase Storage)
- **PDF import** — upload a multi-page PDF, draw regions for the question stem and (for MCQs) each choice; crops upload as PNGs. Uses the pdf.js worker from `unpkg.com` (needs network access in dev/build).
- **Bluebook-Style UI** — fullscreen, distraction-free testing with timer and question navigation
- **LaTeX Editor** — live two-panel rendering with KaTeX
- **AI Grading** — rubric-based FRQ evaluation with structured JSON feedback
- **Grade Appeals** — protest system with AI re-evaluation
- **Roles** — `user` (default), `moderator` (validate/edit/delete questions), `admin` (same + manage accounts)
- **Personal question bank** — new contributions stay private until you submit them for review; moderators publish them to the shared community pool
- **User-Generated Questions** — submit questions and get credited when they're used in community tests
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
2. Go to **SQL Editor** and run the contents of `database/schema.sql` (new projects). If you already ran an older schema, run **`database/migration_images_levels.sql`** once (images / levels / storage), then **`database/migration_roles_question_pool.sql`** (roles, personal/community pools, RLS). If question submit fails with **PGRST204** / missing **`question_image_url`**, run **`database/patch_questions_app_columns.sql`** (idempotent).
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

### Frontend (`frontend/.env.local`)

| Variable                        | Description                     |
| ------------------------------- | ------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key          |
| `NEXT_PUBLIC_API_URL`           | Optional. Omit locally to use `/backend-api` proxy to FastAPI. Set for production (full URL, no trailing slash). |

---

## API Endpoints

| Method | Path                              | Description                |
| ------ | --------------------------------- | -------------------------- |
| POST   | `/auth/signup`                    | Create account             |
| POST   | `/auth/login`                     | Sign in                    |
| GET    | `/auth/me`                        | Current profile + role     |
| GET    | `/admin/users`                    | List users (admin)         |
| PATCH  | `/admin/users/{id}`               | Update profile role/name (admin) |
| DELETE | `/admin/users/{id}`               | Delete auth user (admin)   |
| GET    | `/questions`                      | List published community questions |
| GET    | `/questions/my-bank`              | Your personal + pending    |
| GET    | `/questions/moderation-queue`     | Pending review (mod/admin) |
| POST   | `/questions`                      | Create in personal bank    |
| GET    | `/questions/{id}`                 | Get one (if allowed)       |
| PATCH  | `/questions/{id}`                 | Edit (owner personal / staff) |
| DELETE | `/questions/{id}`                 | Delete (rules per role)    |
| POST   | `/questions/{id}/submit-for-review` | Send personal → moderation |
| POST   | `/questions/{id}/approve`        | Publish (mod/admin)        |
| POST   | `/questions/{id}/reject`         | Return to author’s bank  |
| POST   | `/tests/generate`                 | Generate a test            |
| GET    | `/tests/{id}`                     | Get test with questions    |
| POST   | `/tests/{id}/start`               | Start test timer           |
| POST   | `/submissions/submit`             | Submit all answers         |
| GET    | `/submissions/test/{test_id}`     | Get submissions for a test |
| POST   | `/submissions/grade`              | Request AI re-grade        |
| POST   | `/protests`                       | File a grade appeal        |
| GET    | `/protests/submission/{id}`       | Get protests for submission|
| GET    | `/health`                         | Health check               |

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
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables from `.env.example`

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

# AI Prompt: Full-Stack Website Generation (AI-Graded Exam Platform)

## Overview
You are an expert full-stack software engineer and system architect. Your task is to design and implement a complete, production-ready web application based on the specifications below.

The application is an **AI-powered exam and review platform** that simulates standardized testing environments (similar to Bluebook-style exams), supports LaTeX input/output, and uses AI to grade free-response questions.

---

## Core Requirements

### 1. Platform Features

#### A. Test System
- Generate tests dynamically from a question bank
- Support:
  - Multiple Choice Questions (MCQ)
  - Free Response Questions (FRQ)
- Randomized question selection
- Configurable by:
  - Subject
  - Difficulty
  - Number of questions

#### B. Bluebook-Style UI
- Clean, minimal, exam-focused interface
- Left panel: question navigation
- Main panel: question display
- Timer at top
- Disable distractions
- Automatic Full screen

#### C. LaTeX Support
- Users can input LaTeX in FRQs
- Live preview of rendered math
- Two-panel system:
  - Input (raw LaTeX)
  - Output (rendered math)

#### D. AI Grading System
- Automatically grade FRQs
- Use rubric-based evaluation similar to AP-style grading
- Return:
  - Score
  - Written feedback
- Output must be structured JSON

#### E. Protest System
- Users can dispute grades
- Store:
  - Original answer
  - AI response
  - User appeal
- Re-grade with stricter evaluation logic

#### F. User-Generated Questions
- Users can submit new questions
- Automatically added to database after validation
- Must include:
  - Question
  - Answer
  - Tags
  - Difficulty
- The user will be credited with the question whenever the question is used on another user.
---

## Technical Requirements

### 2. Tech Stack (STRICT)

#### Frontend
- Next.js (App Router)
- React
- Tailwind CSS

#### Backend
- FastAPI (Python)

#### Database
- PostgreSQL (via Supabase)

#### Authentication
- Supabase Auth

#### Storage
- Supabase Storage (for images/assets)

#### LaTeX Rendering
- KaTeX

#### AI Integration
- Must support two modes:
  1. ChatGPT API via 302.ai (default)
  2. Local model via Ollama (fallback)

---

## System Architecture

### 3. Architecture Design

Design a clean architecture with:

- Frontend (Next.js)
- Backend API (FastAPI)
- Database (PostgreSQL)
- AI Service Layer

Include:
- Clear folder structure
- Separation of concerns
- API layer abstraction

---

## Database Design

### 4. Schema Requirements

Create full SQL schema for:

#### Users
- id
- email
- created_at

#### Questions
- id
- type (mcq/frq)
- subject
- difficulty
- content
- latex_enabled
- answer
- rubric
- creator_id

#### Tests
- id
- user_id
- created_at

#### TestQuestions
- test_id
- question_id

#### Submissions
- id
- test_id
- question_id
- user_answer
- score
- feedback

#### Protests
- id
- submission_id
- user_argument
- resolution

---

## API Design

### 5. Required Endpoints

#### Auth
- POST /signup
- POST /login

#### Questions
- GET /questions
- POST /questions

#### Test Generation
- POST /generate-test

#### Submission
- POST /submit-test

#### AI Grading
- POST /grade-frq

#### Protest
- POST /protest

---

## AI Grading Specification

### 6. Prompt Engineering

Design a robust grading prompt that:

- Uses rubric explicitly
- Avoids hallucinations
- Produces JSON output:

```json
{
  "score": number,
  "feedback": "string",
  "justification": "string"
}
```

### Requirements
- Deterministic output (low temperature)
- Clear scoring criteria
- Handle math answers (LaTeX-aware)

---

## Frontend Implementation

### 7. Pages

- / (Landing page)
- /dashboard
- /test/[id]
- /results/[id]

### Components
- QuestionRenderer
- LatexEditor
- Timer
- NavigationPanel
- SubmissionView

---

## Key Functional Logic

### 8. Test Generation Algorithm

- Filter by subject/difficulty
- Random sample
- Ensure no duplicates

### 9. LaTeX Live Rendering

- Debounce input
- Render using KaTeX

### 10. Async AI Grading

- Use background tasks
- Queue system (Redis optional)

---

## Deployment Requirements

### 11. Free Hosting Strategy

- Frontend → Vercel
- Backend → Render
- Database → Supabase

Ensure:
- Environment variables documented
- Deployment steps included

---

## Code Quality Requirements

### 12. Standards

- Clean, readable code
- Modular structure
- Type safety where possible
- Comments for complex logic

---

## Deliverables

You MUST generate:

1. Full frontend code (Next.js)
2. Full backend code (FastAPI)
3. SQL schema
4. API implementation
5. AI grading integration
6. Setup instructions
7. Deployment guide

---

## Additional Constraints

- Optimize for minimal cost (free tiers)
- Avoid unnecessary dependencies
- Ensure scalability

---

## Stretch Goals (Optional)

- Leaderboards
- Adaptive testing
- Analytics dashboard
- Question rating system

---

## Final Instruction

Produce the entire project as if it will be immediately deployed. Include all files, folder structure, and clear instructions. Avoid placeholders—provide real, working implementations wherever possible.


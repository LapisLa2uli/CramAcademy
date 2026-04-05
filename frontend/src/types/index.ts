export type QuestionType = "mcq" | "frq";
export type CourseLevel = "S" | "S+" | "H" | "H+";
export type ProtestStatus = "pending" | "accepted" | "rejected";
export type UserRole = "user" | "moderator" | "admin";
export type QuestionPool = "personal" | "community_pending" | "community";
export type QuestionSource = "personal" | "community" | "both";

export interface Subject {
  id: string;
  name: string;
  levels: string[];
  position: number;
  created_at: string;
}

export interface MCQOption {
  label: string;
  text: string;
  image_url?: string | null;
}

export interface Question {
  id: string;
  type: QuestionType;
  subject: string;
  subject_id?: string | null;
  course_level?: string | null;
  grade_level?: number | null;
  content: string;
  latex_enabled: boolean;
  question_image_url?: string | null;
  options?: MCQOption[];
  answer?: string;
  explanation?: string | null;
  explanation_image_url?: string | null;
  rubric?: Record<string, unknown>;
  tags: string[];
  creator_id?: string;
  validated: boolean;
  pool?: QuestionPool;
  rejection_reason?: string | null;
  question_set_id?: string | null;
  position_in_set?: number | null;
  /** Attached by the backend when the question belongs to a set */
  context_text?: string | null;
  context_image_url?: string | null;
  created_at: string;
  position?: number;
}

export interface QuestionSet {
  id: string;
  creator_id?: string;
  context_text: string;
  context_image_url?: string | null;
  created_at: string;
  questions: Question[];
}

export interface Profile {
  id: string;
  email: string;
  /** Public handle; shown in the header and profile. */
  username?: string;
  bio?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  contribution_points?: number;
  equipped_theme?: string;
  equipped_frame?: string;
  unlocked_themes?: string[];
  unlocked_frames?: string[];
  created_at: string;
}

/** From GET /profile/me — includes computed title and level. */
export interface ProfileMe extends Profile {
  title: string;
  level: number;
  next_title: string | null;
  points_to_next_title: number | null;
}

export interface ContributionDay {
  date: string;
  points: number;
  count: number;
}

export interface ContributionsCalendar {
  days: ContributionDay[];
  total_points: number;
  total_grants: number;
}

export interface AdminUserRow {
  id: string;
  email?: string | null;
  username?: string | null;
  role: UserRole;
  created_at?: string | null;
}

export interface Test {
  id: string;
  user_id: string;
  subject?: string;
  course_level?: string | null;
  grade_level?: number | null;
  time_limit_seconds: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  questions: Question[];
}

export interface Submission {
  id: string;
  test_id: string;
  question_id: string;
  user_answer: string;
  is_correct?: boolean;
  score?: number;
  feedback?: string;
  justification?: string;
  graded_at?: string;
  created_at: string;
}

export interface Protest {
  id: string;
  submission_id: string;
  user_id: string;
  user_argument: string;
  original_score?: number;
  new_score?: number;
  resolution?: string;
  status: ProtestStatus;
  created_at: string;
  resolved_at?: string;
}

export interface UserAnswer {
  question_id: string;
  user_answer: string;
}

export type QuestionTypeFilter = "mixed" | "mcq" | "frq";

export interface TestConfig {
  subject: string;
  course_level?: string;
  grade_level?: number;
  num_questions: number;
  time_limit_seconds: number;
  question_source?: QuestionSource;
  question_type?: QuestionTypeFilter;
}

/** Normalized box on a page image (top-left origin, 0–1). */
export interface ExtractionNormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ExtractionRegionRole =
  | "context"
  | "shared_stem"
  | "question_stem"
  | "choice"
  | "answer_key"
  | "explanation"
  | "frq_prompt"
  | "other";

export interface ExtractionRegion {
  id: string;
  page_index: number;
  role: ExtractionRegionRole;
  label: string;
  bbox: ExtractionNormRect;
  text?: string | null;
  set_index: number;
  question_index?: number | null;
  choice_label?: string | null;
  applies_to_question_numbers?: number[] | null;
  confidence?: number | null;
}

export interface ExtractionPage {
  page_index: number;
  width_px: number;
  height_px: number;
  image_base64: string;
  regions: ExtractionRegion[];
}

export interface ExtractionQuestionDraft {
  question_index: number;
  type: QuestionType;
  content: string;
  options?: { label: string; text: string }[];
  answer: string;
  explanation?: string | null;
  rubric?: Record<string, unknown> | null;
}

export interface ExtractionSetDraft {
  set_index: number;
  context_text: string;
  shared_stems: { applies_to_question_numbers: number[]; text: string }[];
  questions: ExtractionQuestionDraft[];
}

export interface ExtractionAnalyzeResponse {
  warnings: string[];
  pages: ExtractionPage[];
  sets: ExtractionSetDraft[];
}

export interface ExtractionCommitBody {
  subject: string;
  subject_id?: string | null;
  course_level?: string | null;
  grade_level?: number | null;
  tags?: string[];
  sets: {
    context_text: string;
    context_image_url?: string | null;
    questions: {
      type: QuestionType;
      content: string;
      options?: { label: string; text: string }[];
      answer: string;
      explanation?: string | null;
      rubric?: Record<string, unknown> | null;
      latex_enabled?: boolean;
    }[];
  }[];
}

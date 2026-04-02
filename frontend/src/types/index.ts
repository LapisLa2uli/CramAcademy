export type QuestionType = "mcq" | "frq";
export type Difficulty = "easy" | "medium" | "hard";
export type CourseLevel = "S" | "S+" | "H" | "H+";
export type ProtestStatus = "pending" | "accepted" | "rejected";
export type UserRole = "user" | "moderator" | "admin";
export type QuestionPool = "personal" | "community_pending" | "community";
export type QuestionSource = "personal" | "community" | "both";

export interface MCQOption {
  label: string;
  text: string;
  image_url?: string | null;
}

export interface Question {
  id: string;
  type: QuestionType;
  subject: string;
  difficulty: Difficulty;
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
  created_at: string;
  position?: number;
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
  difficulty?: Difficulty;
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

export interface TestConfig {
  subject: string;
  difficulty?: Difficulty;
  course_level?: CourseLevel;
  grade_level?: number;
  num_questions: number;
  time_limit_seconds: number;
  question_source?: QuestionSource;
}

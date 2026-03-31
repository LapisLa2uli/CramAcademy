"use client";

import { useState } from "react";
import type { CourseLevel, Difficulty, TestConfig, QuestionSource } from "@/types";

interface TestConfigFormProps {
  onSubmit: (config: TestConfig) => void;
  loading: boolean;
}

const SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "English",
  "History",
];

const COURSE_LEVELS: { value: CourseLevel | ""; label: string }[] = [
  { value: "", label: "Any level" },
  { value: "S", label: "S (Standard)" },
  { value: "S+", label: "S+ (Standard+)" },
  { value: "H", label: "H (Honors)" },
  { value: "H+", label: "H+ (Honors+)" },
];

export default function TestConfigForm({ onSubmit, loading }: TestConfigFormProps) {
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [courseLevel, setCourseLevel] = useState<CourseLevel | "">("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [numQuestions, setNumQuestions] = useState(10);
  const [timeMinutes, setTimeMinutes] = useState(60);
  const [questionSource, setQuestionSource] = useState<QuestionSource>("both");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      subject,
      difficulty: difficulty || undefined,
      course_level: courseLevel || undefined,
      grade_level: gradeLevel === "" ? undefined : Number(gradeLevel),
      num_questions: numQuestions,
      time_limit_seconds: timeMinutes * 60,
      question_source: questionSource,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-6 max-w-lg">
      <h2 className="text-xl font-semibold text-gray-800">Configure Your Test</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="input-field"
        >
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Course level <span className="text-gray-400">(optional)</span>
        </label>
        <select
          value={courseLevel}
          onChange={(e) => setCourseLevel(e.target.value as CourseLevel | "")}
          className="input-field"
        >
          {COURSE_LEVELS.map(({ value, label }) => (
            <option key={label} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Grade <span className="text-gray-400">(optional)</span>
        </label>
        <select
          value={gradeLevel}
          onChange={(e) =>
            setGradeLevel(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="input-field"
        >
          <option value="">Any grade</option>
          {[6, 7, 8, 9, 10, 11, 12].map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Difficulty <span className="text-gray-400">(optional)</span>
        </label>
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}
          className="input-field"
        >
          <option value="">Any</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Question pool
        </label>
        <select
          value={questionSource}
          onChange={(e) => setQuestionSource(e.target.value as QuestionSource)}
          className="input-field"
        >
          <option value="both">Personal + community (mixed)</option>
          <option value="personal">Personal bank only</option>
          <option value="community">Community bank only (moderator-approved)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Number of Questions
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Time Limit (minutes)
          </label>
          <input
            type="number"
            min={5}
            max={180}
            value={timeMinutes}
            onChange={(e) => setTimeMinutes(Number(e.target.value))}
            className="input-field"
          />
        </div>
      </div>

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Generating Test..." : "Generate Test"}
      </button>
    </form>
  );
}

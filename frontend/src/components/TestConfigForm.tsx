"use client";

import { useCallback, useState } from "react";
import type { TestConfig, QuestionSource, QuestionTypeFilter } from "@/types";
import SubjectPicker from "./SubjectPicker";

interface TestConfigFormProps {
  onSubmit: (config: TestConfig) => void;
  loading: boolean;
}

export default function TestConfigForm({ onSubmit, loading }: TestConfigFormProps) {
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [numQuestions, setNumQuestions] = useState(10);
  const [timeMinutes, setTimeMinutes] = useState(60);
  const [questionSource, setQuestionSource] = useState<QuestionSource>("both");
  const [questionType, setQuestionType] = useState<QuestionTypeFilter>("mixed");

  const handleLevelChange = useCallback((v: string) => setCourseLevel(v), []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName) {
      alert("Please select a subject.");
      return;
    }
    onSubmit({
      subject: subjectName,
      course_level: courseLevel || undefined,
      grade_level: gradeLevel === "" ? undefined : Number(gradeLevel),
      num_questions: numQuestions,
      time_limit_seconds: timeMinutes * 60,
      question_source: questionSource,
      question_type: questionType === "mixed" ? undefined : questionType,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-6 max-w-lg">
      <h2 className="text-xl font-semibold text-gray-800">Configure Your Test</h2>

      <SubjectPicker
        subjectId={subjectId}
        onSubjectChange={(id, name) => { setSubjectId(id); setSubjectName(name); }}
        level={courseLevel}
        onLevelChange={handleLevelChange}
        allowAny={false}
      />

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
          <option value="wrong_book">Wrong answers only (this subject)</option>
        </select>
        {questionSource === "wrong_book" ? (
          <p className="text-xs text-gray-500 mt-1">
            Builds a test from questions you missed on past tests (same subject; optional grade/course filters
            below apply to those questions).
          </p>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Question type
        </label>
        <select
          value={questionType}
          onChange={(e) => setQuestionType(e.target.value as QuestionTypeFilter)}
          className="input-field"
        >
          <option value="mixed">Mixed (MCQ + FRQ)</option>
          <option value="mcq">Multiple Choice only</option>
          <option value="frq">Free Response only</option>
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

      <button type="submit" disabled={loading} className="btn-primary w-full" data-tutorial="generate-btn">
        {loading ? "Generating Test..." : "Generate Test"}
      </button>
    </form>
  );
}

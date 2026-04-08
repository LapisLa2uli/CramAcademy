"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import TestConfigForm from "@/components/TestConfigForm";
import type { TestConfig, WrongBookEntry } from "@/types";
import { uploadQuestionImage } from "@/lib/questionImageUpload";
import SubjectPicker from "@/components/SubjectPicker";
import RubricTableEditor, {
  defaultRubricRows,
  buildRubricFromRows,
} from "@/components/RubricTableEditor";
import LatexHoverPreview from "@/components/LatexHoverPreview";
import QuestionSetForm from "@/components/QuestionSetForm";

const PdfQuestionFromPdfPanel = dynamic(
  () => import("@/components/pdf/PdfQuestionFromPdfPanel"),
  { ssr: false, loading: () => <p className="text-gray-500 text-sm">Loading PDF tools…</p> }
);

const PdfQuestionSetFromPdfPanel = dynamic(
  () => import("@/components/pdf/PdfQuestionSetFromPdfPanel"),
  { ssr: false, loading: () => <p className="text-gray-500 text-sm">Loading PDF tools…</p> }
);

const AiExtractionWizard = dynamic(
  () => import("@/components/extraction/AiExtractionWizard"),
  { ssr: false, loading: () => <p className="text-gray-500 text-sm">Loading AI extraction…</p> }
);

interface RecentTest {
  id: string;
  subject?: string;
  created_at: string;
  finished_at?: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [recentTests, setRecentTests] = useState<RecentTest[]>([]);
  const [wrongSubjectId, setWrongSubjectId] = useState("");
  const [wrongSubjectName, setWrongSubjectName] = useState("");
  const [wrongEntries, setWrongEntries] = useState<WrongBookEntry[]>([]);
  const [wrongLoading, setWrongLoading] = useState(false);
  const [wrongErr, setWrongErr] = useState<string | null>(null);
  const [wrongLoaded, setWrongLoaded] = useState(false);
  const [tab, setTab] = useState<"test" | "contribute">("test");
  const [contributeMode, setContributeMode] = useState<
    "standard" | "pdf" | "question-set" | "pdf-question-set" | "ai-extract"
  >("standard");

  const handleGenerate = async (config: TestConfig) => {
    setGenerating(true);
    try {
      const test = await api.tests.generate(config);
      router.push(`/test/${test.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate test");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void api.tests
      .list(50)
      .then((rows) =>
        setRecentTests(
          rows.map((t) => ({
            id: t.id,
            subject: t.subject,
            created_at: t.created_at,
            finished_at: t.finished_at,
          }))
        )
      )
      .catch(() => setRecentTests([]));
  }, [user?.id]);

  const loadWrongBook = async () => {
    if (!wrongSubjectName.trim()) {
      setWrongErr("Pick a subject to load missed questions.");
      return;
    }
    setWrongErr(null);
    setWrongLoading(true);
    try {
      const rows = await api.tests.wrongBook({ subject: wrongSubjectName.trim() });
      setWrongEntries(rows);
      setWrongLoaded(true);
    } catch (e) {
      setWrongErr(e instanceof Error ? e.message : "Could not load wrong book.");
      setWrongEntries([]);
      setWrongLoaded(false);
    } finally {
      setWrongLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <>
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-gray-100 p-1 rounded-lg w-fit" data-tutorial="main-tabs">
          <button
            onClick={() => setTab("test")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "test"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Take a Test
          </button>
          <button
            onClick={() => setTab("contribute")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "contribute"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Contribute Questions
          </button>
        </div>

        {tab === "test" && (
          <div className="grid lg:grid-cols-2 gap-10">
            <div data-tutorial="test-config">
              <TestConfigForm onSubmit={handleGenerate} loading={generating} />
            </div>

            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4" data-tutorial="recent-tests">Recent tests</h2>
                {recentTests.length === 0 ? (
                  <div className="card p-8 text-center text-gray-400">
                    <p>No tests yet. Generate your first test!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentTests.map((test) => (
                      <Link
                        key={test.id}
                        href={test.finished_at ? `/results/${test.id}` : `/test/${test.id}`}
                        className="card p-4 flex items-center justify-between hover:shadow-md transition-shadow block"
                      >
                        <div>
                          <p className="font-medium text-gray-800">
                            {test.subject || "Mixed"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {new Date(test.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded ${
                            test.finished_at
                              ? "bg-green-50 text-green-600"
                              : "bg-yellow-50 text-yellow-600"
                          }`}
                        >
                          {test.finished_at ? "Completed" : "In Progress"}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Wrong-answer booklet</h2>
                <p className="text-sm text-gray-600 mb-3">
                  Review questions you missed (latest attempt per question). Use{" "}
                  <strong>Question pool → Wrong answers only</strong> in the form to generate a practice test from them.
                </p>
                <div className="card p-4 space-y-3 border border-gray-200">
                  <SubjectPicker
                    subjectId={wrongSubjectId}
                    onSubjectChange={(id, name) => {
                      setWrongSubjectId(id);
                      setWrongSubjectName(name);
                    }}
                    level=""
                    onLevelChange={() => {}}
                    allowAny={false}
                  />
                  <button
                    type="button"
                    className="btn-primary text-sm py-1.5"
                    disabled={wrongLoading || !wrongSubjectName.trim()}
                    onClick={() => void loadWrongBook()}
                  >
                    {wrongLoading ? "Loading…" : "Load missed questions"}
                  </button>
                  {wrongErr && (
                    <p className="text-sm text-red-600">{wrongErr}</p>
                  )}
                  {wrongEntries.length > 0 ? (
                    <ul className="space-y-2 max-h-64 overflow-y-auto text-sm border-t border-gray-100 pt-3">
                      {wrongEntries.map((row) => (
                        <li key={row.question.id} className="border-b border-gray-50 pb-2 last:border-0">
                          <p className="text-gray-800 line-clamp-2">
                            {row.question.content?.slice(0, 160)}
                            {(row.question.content?.length ?? 0) > 160 ? "…" : ""}
                          </p>
                          {row.question.context_text ? (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                              Context: {row.question.context_text.slice(0, 120)}
                              {row.question.context_text.length > 120 ? "…" : ""}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2 mt-1">
                            <Link
                              href={`/results/${row.test_id}`}
                              className="text-xs text-primary-600 hover:underline"
                            >
                              View test results
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : wrongLoaded && wrongEntries.length === 0 && !wrongErr ? (
                    <p className="text-sm text-gray-500">No wrong answers recorded for this subject yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "contribute" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg w-fit" data-tutorial="contribute-tabs">
              {([
                { key: "standard", label: "Standard Form" },
                { key: "question-set", label: "Question Set" },
                { key: "pdf", label: "From PDF / Images" },
                { key: "pdf-question-set", label: "Set from PDF" },
                { key: "ai-extract", label: "AI extract" },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setContributeMode(item.key)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    contributeMode === item.key
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {contributeMode === "standard" ? (
              <QuestionSubmitForm />
            ) : contributeMode === "pdf" ? (
              <PdfQuestionFromPdfPanel userId={user.id} />
            ) : contributeMode === "question-set" ? (
              <QuestionSetForm />
            ) : contributeMode === "pdf-question-set" ? (
              <PdfQuestionSetFromPdfPanel userId={user.id} />
            ) : (
              <AiExtractionWizard />
            )}
          </div>
        )}
    </>
  );
}

type OptionRow = {
  label: string;
  text: string;
  file: File | null;
  preview: string | null;
};

function freshOptions(): OptionRow[] {
  return ["A", "B", "C", "D"].map((label) => ({
    label,
    text: "",
    file: null,
    preview: null,
  }));
}

function QuestionSubmitForm() {
  const { user } = useAuth();
  const previewUrlsRef = useRef<string[]>([]);

  const revokeAllPreviews = () => {
    previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    previewUrlsRef.current = [];
  };

  const trackPreview = (url: string | null) => {
    if (url) previewUrlsRef.current.push(url);
  };

  const [type, setType] = useState<"mcq" | "frq">("mcq");
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [gradeLevel, setGradeLevel] = useState<number | "">("");
  const [content, setContent] = useState("");
  const [stemFile, setStemFile] = useState<File | null>(null);
  const [stemPreview, setStemPreview] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explanationFile, setExplanationFile] = useState<File | null>(null);
  const [explanationPreview, setExplanationPreview] = useState<string | null>(null);
  const [tags, setTags] = useState("");
  const [options, setOptions] = useState<OptionRow[]>(freshOptions);
  const [rubricRows, setRubricRows] = useState(() => defaultRubricRows());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    return () => revokeAllPreviews();
  }, []);

  const setStemImage = (file: File | null) => {
    if (stemPreview) {
      URL.revokeObjectURL(stemPreview);
      previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== stemPreview);
    }
    setStemFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      trackPreview(url);
      setStemPreview(url);
    } else {
      setStemPreview(null);
    }
  };

  const setOptionFile = (index: number, file: File | null) => {
    setOptions((prev) => {
      const next = [...prev];
      const row = next[index];
      if (row.preview) {
        URL.revokeObjectURL(row.preview);
        previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== row.preview);
      }
      if (file) {
        const url = URL.createObjectURL(file);
        previewUrlsRef.current.push(url);
        next[index] = { ...row, file, preview: url };
      } else {
        next[index] = { ...row, file: null, preview: null };
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      alert("You must be signed in to submit a question.");
      return;
    }

    if (!content.trim() && !stemFile) {
      alert("Add question text and/or a question image.");
      return;
    }

    if (type === "mcq") {
      for (const o of options) {
        if (!o.text.trim() && !o.file) {
          alert(`Option ${o.label} needs text and/or an image.`);
          return;
        }
      }
    }

    let rubricObj: Record<string, unknown> | undefined;
    if (type === "frq") {
      rubricObj = buildRubricFromRows(rubricRows) ?? undefined;
      if (!rubricObj) {
        alert(
          "Add at least one rubric row with name, expectations, and points (total must be > 0)."
        );
        return;
      }
    }

    setLoading(true);
    setSuccess(false);

    try {
      let question_image_url: string | undefined;
      if (stemFile) {
        question_image_url = await uploadQuestionImage(user.id, stemFile);
      }

      let explanation_image_url: string | undefined;
      if (explanationFile) {
        explanation_image_url = await uploadQuestionImage(user.id, explanationFile);
      }

      let mcqPayload: { label: string; text: string; image_url?: string }[] | undefined;
      if (type === "mcq") {
        mcqPayload = await Promise.all(
          options.map(async (o) => {
            let image_url: string | undefined;
            if (o.file) {
              image_url = await uploadQuestionImage(user.id, o.file);
            }
            return {
              label: o.label,
              text: o.text.trim(),
              ...(image_url ? { image_url } : {}),
            };
          })
        );
      }

      await api.questions.create({
        type,
        subject: subjectName,
        ...(subjectId ? { subject_id: subjectId } : {}),
        ...(courseLevel ? { course_level: courseLevel } : {}),
        ...(gradeLevel !== "" ? { grade_level: Number(gradeLevel) } : {}),
        content: content.trim(),
        ...(question_image_url ? { question_image_url } : {}),
        answer,
        ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
        ...(explanation_image_url ? { explanation_image_url } : {}),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        latex_enabled: content.includes("$") || explanation.includes("$"),
        options: mcqPayload,
        rubric: rubricObj,
      });
      setSuccess(true);
      setContent("");
      setAnswer("");
      setExplanation("");
      if (stemPreview) URL.revokeObjectURL(stemPreview);
      if (explanationPreview) URL.revokeObjectURL(explanationPreview);
      options.forEach((o) => {
        if (o.preview) URL.revokeObjectURL(o.preview);
      });
      previewUrlsRef.current = [];
      setStemFile(null);
      setStemPreview(null);
      setExplanationFile(null);
      setExplanationPreview(null);
      setOptions(freshOptions());
      setRubricRows(defaultRubricRows());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit question");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-gray-800">Submit a Question</h2>
      <p className="text-sm text-gray-500">
        New questions are saved to your <strong>personal question bank</strong> (only you can see
        them). From <strong>My question bank</strong> you can submit them for moderator review to
        join the shared community pool. Images upload to Supabase Storage (max 5 MB,
        JPEG/PNG/WebP/GIF).
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "mcq" | "frq")}
            className="input-field"
          >
            <option value="mcq">Multiple Choice</option>
            <option value="frq">Free Response</option>
          </select>
        </div>
        <SubjectPicker
          subjectId={subjectId}
          onSubjectChange={(id, name) => { setSubjectId(id); setSubjectName(name); }}
          level={courseLevel}
          onLevelChange={setCourseLevel}
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
            <option value="">—</option>
            {[6, 7, 8, 9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Question text{" "}
          <span className="text-gray-400">(optional if you add an image; LaTeX: $...$)</span>
        </label>
        <LatexHoverPreview value={content}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="input-field min-h-[120px]"
            placeholder="Enter the question text..."
          />
        </LatexHoverPreview>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Question image <span className="text-gray-400">(optional)</span>
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="text-sm text-gray-600"
          onChange={(e) => setStemImage(e.target.files?.[0] ?? null)}
        />
        {stemPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stemPreview}
            alt="Preview"
            className="mt-2 max-h-48 rounded border border-gray-200 object-contain"
          />
        )}
      </div>

      {type === "mcq" && (
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">Options (text and/or image)</label>
          {options.map((opt, i) => (
            <div
              key={opt.label}
              className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/50"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-500 w-6">{opt.label}.</span>
                <LatexHoverPreview value={opt.text}>
                  <input
                    value={opt.text}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...opt, text: e.target.value };
                      setOptions(next);
                    }}
                    className="input-field flex-1"
                    placeholder={`Option ${opt.label} text (LaTeX: $...$)`}
                  />
                </LatexHoverPreview>
              </div>
              <div className="ml-8">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="text-xs text-gray-600"
                  onChange={(e) => setOptionFile(i, e.target.files?.[0] ?? null)}
                />
                {opt.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={opt.preview}
                    alt={`Preview ${opt.label}`}
                    className="mt-2 max-h-32 rounded border border-gray-200 object-contain"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {type === "frq" && (
        <RubricTableEditor rows={rubricRows} onChange={setRubricRows} />
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Correct Answer {type === "mcq" && "(letter)"}
        </label>
        <LatexHoverPreview value={answer}>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            className="input-field"
            placeholder={type === "mcq" ? "A" : "Model answer or solution"}
          />
        </LatexHoverPreview>
      </div>

      {type === "mcq" && (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-700">
            Explanation <span className="text-gray-400">(optional; shown after grading)</span>
          </h3>
          <LatexHoverPreview value={explanation}>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="input-field min-h-[80px]"
              placeholder="Why is this the correct answer? (LaTeX: $...$)"
            />
          </LatexHoverPreview>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Explanation image <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="text-xs text-gray-600"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (explanationPreview) {
                  URL.revokeObjectURL(explanationPreview);
                  previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== explanationPreview);
                }
                setExplanationFile(f);
                if (f) {
                  const url = URL.createObjectURL(f);
                  previewUrlsRef.current.push(url);
                  setExplanationPreview(url);
                } else {
                  setExplanationPreview(null);
                }
              }}
            />
            {explanationPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={explanationPreview}
                alt="Explanation preview"
                className="mt-2 max-h-32 rounded border border-gray-200 object-contain"
              />
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tags <span className="text-gray-400">(comma-separated)</span>
        </label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="input-field"
          placeholder="algebra, quadratic, factoring"
        />
      </div>

      {success && (
        <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
          Saved to your personal bank. Open <strong>My question bank</strong> to submit it for
          community review.
        </p>
      )}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Uploading & submitting..." : "Submit Question"}
      </button>
    </form>
  );
}

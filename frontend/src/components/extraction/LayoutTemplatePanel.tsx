"use client";

import { useCallback } from "react";
import {
  REGION_DRAG_MIME,
  buildSlotsForSet,
  manualAnswerKey,
  pruneAssignments,
  type LayoutSetTemplate,
} from "@/lib/extraction/slotLayoutTypes";
import { assignRegionToSlot } from "@/lib/extraction/buildCommitFromSlotLayout";

function DropSlot({
  slotId,
  label,
  assignedRegionId,
  previewUrl,
  onAssign,
  onClear,
  children,
}: {
  slotId: string;
  label: string;
  assignedRegionId: string | null | undefined;
  previewUrl?: string | null;
  onAssign: (slotId: string, regionId: string) => void;
  onClear: (slotId: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="border-2 border-dashed border-gray-300 rounded-md p-2 min-h-[52px] bg-white transition-colors hover:border-gray-400"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(REGION_DRAG_MIME);
        if (id) onAssign(slotId, id);
      }}
    >
      <div className="text-[11px] font-medium text-gray-700 mb-1">{label}</div>
      {assignedRegionId ? (
        <div className="flex items-center gap-2 flex-wrap">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="h-11 w-auto max-w-[100px] object-contain rounded border border-gray-200"
            />
          ) : null}
          <span className="text-[10px] text-gray-600 font-mono truncate max-w-[140px]" title={assignedRegionId}>
            {assignedRegionId.length > 18 ? `${assignedRegionId.slice(0, 18)}…` : assignedRegionId}
          </span>
          <button
            type="button"
            className="text-xs text-red-600 hover:underline"
            onClick={() => onClear(slotId)}
          >
            Clear
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">Drag a layout box here</p>
      )}
      {children}
    </div>
  );
}

export default function LayoutTemplatePanel({
  templates,
  setTemplates,
  assignments,
  setAssignments,
  manualAnswers,
  setManualAnswers,
  regionPreviewById,
}: {
  templates: LayoutSetTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<LayoutSetTemplate[]>>;
  assignments: Record<string, string | null>;
  setAssignments: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  manualAnswers: Record<string, string>;
  setManualAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  regionPreviewById: Record<string, string>;
}) {
  const addQuestionSet = useCallback(() => {
    setTemplates((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        contextSlotCount: 1,
        questions: [{ choiceCount: 4 }],
      },
    ]);
  }, [setTemplates]);

  const addSingleQuestion = useCallback(() => {
    setTemplates((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        contextSlotCount: 0,
        questions: [{ choiceCount: 4 }],
      },
    ]);
  }, [setTemplates]);

  const removeTemplate = useCallback(
    (id: string) => {
      setTemplates((prev) => {
        const next = prev.filter((t) => t.id !== id);
        setAssignments((a) => pruneAssignments(next, a));
        return next;
      });
    },
    [setTemplates, setAssignments]
  );

  const onAssign = useCallback(
    (slotId: string, regionId: string) => {
      setAssignments((prev) => assignRegionToSlot(prev, slotId, regionId));
    },
    [setAssignments]
  );

  const onClearSlot = useCallback(
    (slotId: string) => {
      setAssignments((prev) => ({ ...prev, [slotId]: null }));
    },
    [setAssignments]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-sm py-1.5 px-3" onClick={addQuestionSet}>
          Add question set
        </button>
        <button
          type="button"
          className="text-sm py-1.5 px-3 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50"
          onClick={addSingleQuestion}
        >
          Add single question
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-500">
          Add a set or a single question, then drag boxes from the page into the slots.
        </p>
      ) : null}

      {templates.map((t, ti) => (
        <div key={t.id} className="card p-4 space-y-3 border border-gray-200">
          <div className="flex justify-between items-center gap-2">
            <span className="text-sm font-semibold text-purple-800">
              {t.contextSlotCount > 0 ? `Set ${ti + 1}` : `Question ${ti + 1}`}
            </span>
            <button
              type="button"
              className="text-xs text-red-600 hover:underline"
              onClick={() => removeTemplate(t.id)}
            >
              Remove
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600">Context slots</span>
              <input
                type="number"
                min={0}
                max={8}
                className="input-field text-sm py-1"
                value={t.contextSlotCount}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(8, Number(e.target.value) || 0));
                  setTemplates((prev) => {
                    const next = prev.map((x) =>
                      x.id === t.id ? { ...x, contextSlotCount: n } : x
                    );
                    setAssignments((a) => pruneAssignments(next, a));
                    return next;
                  });
                }}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600"># Questions</span>
              <input
                type="number"
                min={1}
                max={40}
                className="input-field text-sm py-1"
                value={t.questions.length}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(40, Number(e.target.value) || 1));
                  setTemplates((prev) => {
                    const next = prev.map((x) => {
                      if (x.id !== t.id) return x;
                      const qs = [...x.questions];
                      while (qs.length < n) qs.push({ choiceCount: 4 });
                      qs.length = n;
                      return { ...x, questions: qs };
                    });
                    setAssignments((a) => pruneAssignments(next, a));
                    return next;
                  });
                }}
              />
            </label>
          </div>

          {t.questions.map((q, qi) => (
            <div key={qi} className="border-t border-gray-100 pt-2 space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <span className="text-gray-600 w-28">Q{qi + 1} choices</span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  className="input-field text-sm py-1 w-20"
                  value={q.choiceCount}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(12, Number(e.target.value) || 0));
                    setTemplates((prev) => {
                      const next = prev.map((x) => {
                        if (x.id !== t.id) return x;
                        const qs = x.questions.map((row, j) =>
                          j === qi ? { ...row, choiceCount: n } : row
                        );
                        return { ...x, questions: qs };
                      });
                      setAssignments((a) => pruneAssignments(next, a));
                      return next;
                    });
                  }}
                />
                <span className="text-gray-400">0 = free response</span>
              </label>
            </div>
          ))}

          <div className="space-y-2">
            {buildSlotsForSet(t).map(({ slotId, label }) => {
              const rid = assignments[slotId] ?? null;
              const qnMatch = slotId.match(/-q(\d+)-(stem|c\d+|ans|exp)/);
              const qOrd = qnMatch ? Number(qnMatch[1]) : 0;
              const kind = qnMatch?.[2];
              const isAns = kind === "ans";
              const isExp = kind === "exp";
              const mkAns = manualAnswerKey(t.id, qOrd, "answer");
              const mkExp = manualAnswerKey(t.id, qOrd, "exp");

              return (
                <DropSlot
                  key={slotId}
                  slotId={slotId}
                  label={label}
                  assignedRegionId={rid}
                  previewUrl={rid ? regionPreviewById[rid] : undefined}
                  onAssign={onAssign}
                  onClear={onClearSlot}
                >
                  {isAns ? (
                    <input
                      className="input-field text-xs mt-2 w-full"
                      placeholder="Or type answer (e.g. A)"
                      value={manualAnswers[mkAns] || ""}
                      onChange={(e) =>
                        setManualAnswers((m) => ({ ...m, [mkAns]: e.target.value }))
                      }
                    />
                  ) : null}
                  {isExp ? (
                    <input
                      className="input-field text-xs mt-2 w-full"
                      placeholder="Or type explanation"
                      value={manualAnswers[mkExp] || ""}
                      onChange={(e) =>
                        setManualAnswers((m) => ({ ...m, [mkExp]: e.target.value }))
                      }
                    />
                  ) : null}
                </DropSlot>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

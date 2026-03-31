"use client";

export type RubricRow = {
  name: string;
  expectations: string;
  points: string;
};

const emptyRow = (): RubricRow => ({ name: "", expectations: "", points: "0" });

export function defaultRubricRows(): RubricRow[] {
  return [emptyRow(), emptyRow(), emptyRow()];
}

export function buildRubricFromRows(rows: RubricRow[]): {
  criteria: { name: string; expectations: string; points: number }[];
  max_score: number;
} | null {
  const valid = rows.filter((r) => r.name.trim() && r.expectations.trim());
  if (valid.length === 0) return null;
  const criteria = valid.map((r) => ({
    name: r.name.trim(),
    expectations: r.expectations.trim(),
    points: Math.max(0, Number(r.points) || 0),
  }));
  const max_score = criteria.reduce((s, c) => s + c.points, 0);
  if (max_score <= 0) return null;
  return { criteria, max_score };
}

interface RubricTableEditorProps {
  rows: RubricRow[];
  onChange: (rows: RubricRow[]) => void;
}

export default function RubricTableEditor({ rows, onChange }: RubricTableEditorProps) {
  const update = (i: number, patch: Partial<RubricRow>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const addRow = () => onChange([...rows, emptyRow()]);
  const removeRow = (i: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, j) => j !== i));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          Grading rubric <span className="text-gray-400 font-normal">(one row per criterion)</span>
        </label>
        <button type="button" onClick={addRow} className="text-sm text-primary-600 hover:text-primary-700">
          + Add row
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left p-2 font-medium text-gray-700 w-[22%]">Criterion name</th>
              <th className="text-left p-2 font-medium text-gray-700">Expectations</th>
              <th className="text-left p-2 font-medium text-gray-700 w-24">Points</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-100 align-top">
                <td className="p-2">
                  <input
                    value={row.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="input-field py-1.5 text-sm"
                    placeholder="e.g. Reasoning"
                  />
                </td>
                <td className="p-2">
                  <textarea
                    value={row.expectations}
                    onChange={(e) => update(i, { expectations: e.target.value })}
                    className="input-field py-1.5 text-sm min-h-[72px] resize-y"
                    placeholder="What earns full credit for this criterion?"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={row.points}
                    onChange={(e) => update(i, { points: e.target.value })}
                    className="input-field py-1.5 text-sm"
                  />
                </td>
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-gray-400 hover:text-red-600 text-xs"
                    disabled={rows.length <= 1}
                    title="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Total max score is the sum of the Points column (stored with the question for AI grading).
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface ProtestFormProps {
  submissionId: string;
  onSubmitted: () => void;
}

export default function ProtestForm({ submissionId, onSubmitted }: ProtestFormProps) {
  const [argument, setArgument] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!argument.trim()) return;
    setLoading(true);
    try {
      const protest = await api.protests.create(submissionId, argument);
      setResult(
        protest.status === "accepted"
          ? `Appeal accepted! New score: ${protest.new_score}`
          : `Appeal ${protest.status}. ${protest.resolution || ""}`
      );
      setTimeout(onSubmitted, 3000);
    } catch (err: unknown) {
      setResult(err instanceof Error ? err.message : "Failed to submit protest");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-red-200 rounded-lg p-4 space-y-3 bg-red-50">
      <h4 className="text-sm font-semibold text-red-700">Dispute this Grade</h4>
      <textarea
        value={argument}
        onChange={(e) => setArgument(e.target.value)}
        placeholder="Explain why you believe this grade is incorrect..."
        className="input-field min-h-[100px] text-sm"
      />
      {result && (
        <p className="text-sm font-medium text-gray-700">{result}</p>
      )}
      <button
        onClick={handleSubmit}
        disabled={loading || !argument.trim()}
        className="btn-primary text-sm"
      >
        {loading ? "Submitting..." : "Submit Appeal"}
      </button>
    </div>
  );
}

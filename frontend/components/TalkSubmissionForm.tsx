/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0";
import type { SubmissionData } from "./App.tsx";

interface TalkSubmissionFormProps {
  onSubmit: (data: SubmissionData) => void;
  isSubmitting: boolean;
  error: string | null;
}

export default function TalkSubmissionForm({ onSubmit, isSubmitting, error }: TalkSubmissionFormProps) {
  const [formData, setFormData] = useState<SubmissionData>({
    speakerName: "",
    talkContext: "",
    isOnBehalf: false,
    submitterName: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation
    if (!formData.speakerName.trim() || !formData.talkContext.trim()) {
      return;
    }

    // Validate submitter name if submitting on behalf
    if (formData.isOnBehalf && !formData.submitterName?.trim()) {
      return;
    }

    onSubmit(formData);
  };

  const handleInputChange = (field: keyof SubmissionData, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const isFormValid = formData.speakerName.trim() && 
                     formData.talkContext.trim() && 
                     (!formData.isOnBehalf || formData.submitterName?.trim());

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Speaker Name */}
        <div>
          <label htmlFor="speakerName" className="block text-sm font-mono text-secondary mb-2">
            Speaker Name *
          </label>
          <input
            type="text"
            id="speakerName"
            required
            value={formData.speakerName}
            onChange={(e) => handleInputChange("speakerName", e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded bg-white font-mono text-sm focus:outline-none focus:border-[var(--accent-primary)] focus:border-2"
            placeholder="Enter the speaker's full name"
            disabled={isSubmitting}
          />
        </div>

        {/* Talk Context */}
        <div>
          <label htmlFor="talkContext" className="block text-sm font-mono text-secondary mb-2">
            Talk Context *
          </label>
          <textarea
            id="talkContext"
            required
            rows={4}
            value={formData.talkContext}
            onChange={(e) => handleInputChange("talkContext", e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-default)] rounded bg-white font-mono text-sm focus:outline-none focus:border-[var(--accent-primary)] focus:border-2"
            placeholder="Describe the talk topic, key points, target audience, and any other relevant context..."
            disabled={isSubmitting}
          />
        </div>

        {/* On Behalf Checkbox */}
        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input
              id="isOnBehalf"
              type="checkbox"
              checked={formData.isOnBehalf}
              onChange={(e) => handleInputChange("isOnBehalf", e.target.checked)}
              className="w-4 h-4 accent-[var(--accent-primary)] bg-white border-[var(--border-default)] rounded focus:ring-2 focus:ring-[var(--accent-primary)]"
              disabled={isSubmitting}
            />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor="isOnBehalf" className="font-mono text-secondary">
              I am submitting this on behalf of someone else
            </label>
            <p className="text-xs font-mono text-muted mt-1">
              Check this if you're not the speaker but are submitting for them
            </p>
          </div>
        </div>

        {/* Submitter Name - Only show when submitting on behalf */}
        {formData.isOnBehalf && (
          <div className="bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded p-4">
            <label htmlFor="submitterName" className="block text-sm font-mono text-secondary mb-2">
              Your Name (Submitter) *
            </label>
            <input
              type="text"
              id="submitterName"
              required={formData.isOnBehalf}
              value={formData.submitterName || ""}
              onChange={(e) => handleInputChange("submitterName", e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded bg-white font-mono text-sm focus:outline-none focus:border-[var(--accent-primary)] focus:border-2"
              placeholder="Enter your full name"
              disabled={isSubmitting}
            />
            <p className="text-xs font-mono text-muted mt-2">
              Since you're submitting on behalf of the speaker, please provide your name for our records.
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-[var(--error)] rounded p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <span className="text-error">⚠</span>
              </div>
              <div className="ml-3">
                <p className="text-sm font-mono text-error">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div>
          <button
            type="submit"
            disabled={isSubmitting || !isFormValid}
            className="w-full flex justify-center py-3 px-6 border border-[var(--accent-primary)] rounded bg-[var(--accent-primary)] text-primary font-mono text-sm font-medium hover:bg-[var(--accent-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing Submission...
              </>
            ) : (
              "Submit Talk Proposal"
            )}
          </button>
        </div>
      </form>

      <div className="mt-6 text-center text-xs font-mono text-muted">
        <p>
          After submission, a Discord channel will be created for discussion
          and you'll receive an invitation link.
        </p>
      </div>
    </div>
  );
}
/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useState } from "https://esm.sh/react@18.2.0";
import TalkSubmissionForm from "./TalkSubmissionForm.tsx";
import SubmissionSuccess from "./SubmissionSuccess.tsx";

export interface SubmissionData {
  speakerName: string;
  talkContext: string;
  isOnBehalf: boolean;
  submitterName?: string;
}

export interface SubmissionResult {
  success: boolean;
  submissionId: number;
  discordInviteLink: string;
}

export default function App() {
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmission = async (data: SubmissionData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to submit");
      }

      setSubmissionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmissionResult(null);
    setError(null);
  };

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet" />
      
      <style>{`
        :root {
          --bg-primary: #f8f9fa;
          --bg-secondary: #e9ecef;
          --bg-tertiary: #dee2e6;
          --text-primary: #2d3748;
          --text-secondary: #4a5568;
          --text-muted: #718096;
          --accent-primary: #d69e2e;
          --accent-secondary: #b7791f;
          --accent-subtle: #faf089;
          --border-default: #cbd5e0;
          --border-focus: #d69e2e;
          --success: #38a169;
          --error: #e53e3e;
          --warning: #dd6b20;
          --info: #3182ce;
        }
        
        body {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          background-color: var(--bg-primary);
          color: var(--text-primary);
          line-height: 1.6;
        }
        
        .font-heading {
          font-family: 'Instrument Serif', serif !important;
        }
        
        .font-mono {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }
        
        .text-primary { color: var(--text-primary); }
        .text-secondary { color: var(--text-secondary); }
        .text-muted { color: var(--text-muted); }
        .text-success { color: var(--success); }
        .text-error { color: var(--error); }
        .text-accent { color: var(--accent-primary); }
      `}</style>
      
      <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4">
        <div className="max-w-[480px] mx-auto">
          <div className="text-center mb-8">
            <h1 className="font-heading text-4xl font-semibold text-primary mb-3">
              Rust NYC Talk Submissions
            </h1>
            <p className="font-mono text-sm text-secondary tracking-wide">
              Submit your talk proposal and get connected with our organizers
            </p>
          </div>

        {submissionResult ? (
          <SubmissionSuccess 
            result={submissionResult} 
            onReset={handleReset}
          />
        ) : (
          <TalkSubmissionForm
            onSubmit={handleSubmission}
            isSubmitting={isSubmitting}
            error={error}
          />
        )}
        </div>
      </div>
    </>
  );
}
/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React from "https://esm.sh/react@18.2.0";
import type { SubmissionResult } from "./App.tsx";

interface SubmissionSuccessProps {
  result: SubmissionResult;
  onReset: () => void;
}

export default function SubmissionSuccess({ result, onReset }: SubmissionSuccessProps) {
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(result.discordInviteLink);
      // Could add a toast notification here
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded p-6">
      <div className="text-center">
        {/* Success Icon */}
        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-[var(--success)] bg-opacity-20 mb-4">
          <span className="text-xl text-success">✓</span>
        </div>

        {/* Success Message */}
        <h2 className="font-heading text-2xl font-semibold text-primary mb-2">
          Submission Successful
        </h2>
        <p className="font-mono text-sm text-secondary mb-6">
          Your talk proposal has been submitted and our organizers have been notified.
        </p>

        {/* Submission Details */}
        <div className="bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded p-4 mb-6">
          <p className="text-sm font-mono text-secondary">
            <span className="text-muted">Submission ID:</span> #{result.submissionId}
          </p>
        </div>

        {/* Discord Invite Section */}
        <div className="border-2 border-dashed border-[var(--accent-primary)] rounded p-6 mb-6">
          <div className="flex items-center justify-center mb-3">
            <span className="text-xl mr-2">💬</span>
            <h3 className="font-heading text-2xl font-medium" style={{color: 'var(--text-primary)'}}>
              Discord Discussion Channel
            </h3>
          </div>
          
          <p className="font-mono text-sm text-secondary mb-4">
            A dedicated Discord channel has been created for discussing your talk proposal.
            Join the conversation with our organizers!
          </p>

          <div className="space-y-3">
            {/* Invite Link Display */}
            <div className="bg-white border border-[var(--border-default)] rounded p-3">
              <div className="flex items-center justify-between">
                <code className="text-sm text-accent font-mono break-all">
                  {result.discordInviteLink}
                </code>
                <button
                  onClick={copyInviteLink}
                  className="ml-2 p-1 text-muted hover:text-secondary focus:outline-none"
                  title="Copy link"
                >
                  📋
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={result.discordInviteLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[var(--accent-primary)] text-primary px-4 py-2 rounded text-sm font-mono font-medium hover:bg-[var(--accent-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] text-center"
              >
                Join Discord Channel
              </a>
              <button
                onClick={copyInviteLink}
                className="flex-1 bg-[var(--bg-tertiary)] text-secondary px-4 py-2 rounded text-sm font-mono font-medium hover:bg-[var(--border-default)] focus:outline-none focus:ring-2 focus:ring-[var(--border-default)]"
              >
                Copy Invite Link
              </button>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="text-left bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded p-4 mb-6">
          <h4 className="font-mono text-sm font-medium text-secondary mb-2">What happens next?</h4>
          <ul className="text-xs font-mono text-muted space-y-1">
            <li>• Our organizers have been notified of your submission</li>
            <li>• Join the Discord channel to discuss details</li>
            <li>• We'll review your proposal and get back to you soon</li>
            <li>• Keep an eye on Discord for updates and questions</li>
          </ul>
        </div>

        {/* Reset Button */}
        <button
          onClick={onReset}
          className="text-accent hover:text-[var(--accent-secondary)] text-sm font-mono font-medium focus:outline-none"
        >
          Submit Another Talk →
        </button>
      </div>
    </div>
  );
}
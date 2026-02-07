# Feature Concept: Anonymized Review Mode

**Status**: PR-Ready Concept  
**Author**: Feature Design Task  
**Target Files**: `backend/index.ts`, `shared/types.ts`

---

## Executive Summary

**Name**: **Blind Review Mode** (user-facing) / `anonymized_review` (internal)

A name-blind review system that temporarily hides speaker identity from reviewers during initial talk evaluation, revealing identity only after a preliminary decision is recorded. Designed to reduce unconscious bias in talk selection while maintaining practical workflow needs.

---

## How It Works

### 1. Submission Flow (Enhanced)

```
Speaker submits → System generates anonymous ID → Two views created:
                                                   ├─ Blind view (reviewers)
                                                   └─ Full view (speaker channel)
```

**Backend changes** (`backend/index.ts`, lines 45-95):

```typescript
// New fields in submission INSERT
anonymous_id: generateAnonymousId(), // e.g., "TALK-7X3K"
review_phase: 'blind',               // 'blind' | 'revealed' | 'decided'
redacted_context: redactIdentifiers(talkContext),
```

### 2. Review Workflow

| Phase | Reviewer Sees | Actions Available |
|-------|--------------|-------------------|
| **Blind** | Anonymous ID + redacted talk context | Rate (1-5), Vote (Accept/Maybe/Reject), Add notes |
| **Reveal Trigger** | (after vote submitted) | Identity revealed, can adjust vote once |
| **Decided** | Full context + speaker name | Final decision locked |

### 3. Discord Channel Architecture

```
#organizers (notification only)
    └── "[BLIND] TALK-7X3K submitted - see review portal"

#review-portal (new private channel)
    └── Blind cards posted, voting via reactions or slash commands

#nodate-123-jane-doe (speaker's channel - unchanged)
    └── Full context, speaker can see their own submission
```

**Key insight**: Reviewers interact via a centralized `#review-portal` channel with blind cards, NOT individual speaker channels during blind phase.

---

## Bias Risks & Mitigations

### Risk Matrix

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Self-identification in talk context** ("I'm Jane, senior engineer at Google...") | HIGH | Automated redaction + manual flag system |
| **Prior speaker recognition** (unique talk style) | MEDIUM | Randomize review order per reviewer |
| **Company/affiliation mentions** | HIGH | NLP-based entity detection for org names |
| **Pronoun/demographic leakage** | LOW | Optional: neutralize pronouns (controversial) |
| **Cross-talk correlation** | LOW | Anonymous IDs are per-submission, not per-speaker |

### Redaction Strategy (`backend/redact.ts` - new file)

```typescript
interface RedactionResult {
  redactedText: string;
  redactionCount: number;
  flaggedForManualReview: boolean;
  confidence: number; // 0-1
}

function redactIdentifiers(text: string): RedactionResult {
  // Layer 1: Regex patterns (emails, @handles, URLs)
  // Layer 2: Named entity recognition (names, companies)
  // Layer 3: Heuristic phrases ("I work at", "my name is", "at [Company]")
  // Layer 4: Low-confidence flag for human review
}
```

**Fallback**: If confidence < 0.7, submission enters "manual review queue" where an admin approves the redacted version before it goes to blind review.

---

## Opt-In/Opt-Out Design

### For Organizers (Event-Level)

```typescript
// Config in loadEnv() - backend/config.ts
interface ReviewConfig {
  blindReviewEnabled: boolean;        // Master toggle
  blindReviewMandatory: boolean;      // If false, reviewers can opt-out
  revealThreshold: number;            // Votes needed before reveal (default: 1)
  autoRevealAfterDays: number;        // Safety valve (default: 14)
}
```

### For Reviewers (Individual)

- **Default**: Blind mode ON
- **Opt-out**: Reviewers with `blind_review_optout` role see full context (useful for logistics coordinators who need speaker contact info)
- **Audit trail**: All opt-outs logged with timestamp and reason

### For Speakers

- **Informed consent**: Submission form includes notice: "Your identity will be hidden during initial review to reduce bias"
- **No speaker opt-out**: Blind review is a community fairness feature, not speaker choice (prevents gaming)

---

## Data Model Changes

**`shared/types.ts` additions:**

```typescript
export interface TalkSubmission {
  // ... existing fields ...
  
  // Anonymization fields
  anonymous_id: string;              // "TALK-XXXX" format
  review_phase: ReviewPhase;
  redacted_context: string;
  redaction_confidence: number;
  manual_review_required: boolean;
  
  // Review tracking
  blind_votes: BlindVote[];
  revealed_at?: string;              // ISO timestamp
  revealed_by?: string;              // reviewer who triggered reveal
}

export type ReviewPhase = 'blind' | 'revealed' | 'decided';

export interface BlindVote {
  reviewer_id: string;
  vote: 'accept' | 'maybe' | 'reject';
  rating: number;                    // 1-5
  notes?: string;
  voted_at: string;
  was_blind: boolean;                // true if voted before seeing identity
}
```

**Database migration** (new table `talk_submissions_4`):

```sql
ALTER TABLE ... ADD COLUMN anonymous_id TEXT UNIQUE;
ALTER TABLE ... ADD COLUMN review_phase TEXT DEFAULT 'blind';
ALTER TABLE ... ADD COLUMN redacted_context TEXT;
ALTER TABLE ... ADD COLUMN redaction_confidence REAL;
ALTER TABLE ... ADD COLUMN revealed_at DATETIME;
```

---

## Success Metrics

### Primary Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Bias reduction** | ≥15% increase in acceptance rate for first-time speakers | Compare blind vs. historical non-blind cohorts |
| **Vote consistency** | ≥80% of reviewers maintain vote after reveal | `blind_vote == revealed_vote` |
| **Redaction accuracy** | ≤5% of submissions require manual review escalation | `manual_review_required` rate |

### Secondary Metrics

- **Reviewer satisfaction**: Post-event survey ("Did blind review feel fair?")
- **Time-to-decision**: Should not increase by >20% vs. non-blind
- **Speaker diversity**: Track new speaker acceptance rates (with consent)

### Anti-Metrics (Things We DON'T Optimize)

- Speed at all costs (quality > velocity)
- 100% automation (human judgment is valuable)

---

## Mock Press Release Outline

### Headline
**"Rust NYC Launches Blind Review for Talk Submissions, Pioneering Bias-Free Tech Event Curation"**

### Subhead
*First meetup in NYC tech scene to implement academic-style blind review for community talks*

### Opening Paragraph
Rust NYC today announced Blind Review Mode for its talk submission system, automatically anonymizing speaker identities during the initial review phase. The feature aims to ensure talks are evaluated purely on technical merit and relevance, reducing unconscious bias based on speaker reputation, employer, or background.

### Quote (Organizer)
> "We've always believed the best talks come from anywhere in our community—whether you're a first-time speaker or a Rust core team member. Blind review makes that belief systemic, not aspirational."
> — [Organizer Name], Rust NYC

### How It Works (Brief)
When speakers submit talks, the system generates an anonymous identifier (e.g., "TALK-7X3K") and intelligently redacts identifying information from the proposal. Reviewers evaluate proposals without seeing names, companies, or social handles. Only after recording their initial assessment does the speaker's identity become visible, allowing reviewers to factor in logistics (availability, prior speaking experience) for final decisions.

### Quote (Community)
> "As someone who's been rejected from conferences where I later saw less technical talks accepted from 'known names,' this feels like a genuine step toward meritocracy."
> — Community Member

### FAQ Section

**Q: What if someone mentions their company in the talk description?**
A: Our system uses pattern matching and entity detection to redact company names, handles, and identifying phrases. Low-confidence redactions are flagged for human review.

**Q: Can reviewers cheat by looking up anonymous IDs?**
A: Anonymous IDs are random and not published anywhere. The only correlation exists in our database, inaccessible to reviewers.

**Q: Does this slow down the review process?**
A: Initial testing shows <10% increase in review time, offset by higher reviewer confidence in decisions.

**Q: What about returning speakers we want to invite back?**
A: Organizers with the "program committee" role can access the unblinded view for outreach purposes, with full audit logging.

### Availability
Blind Review Mode will be available for all Rust NYC talk submissions starting [DATE]. The feature is open-source and available for other meetups to adopt.

---

## Implementation Estimate

| Component | Effort | Dependencies |
|-----------|--------|--------------|
| Database schema migration | 2 hours | None |
| Redaction engine (regex + heuristics) | 4 hours | None |
| Redaction engine (NLP entity detection) | 8 hours | External API or library |
| Discord review portal integration | 6 hours | Discord bot permissions |
| Frontend reviewer dashboard | 8 hours | New React components |
| Admin manual review queue | 4 hours | Frontend + API |
| Metrics dashboard | 4 hours | Analytics integration |
| **Total** | **~36 hours** | |

---

## Remaining Work

For orchestrator follow-up:

1. **Decision needed**: NLP provider for entity detection (OpenAI, local model, or regex-only MVP?)
2. **Design review**: Mock up the Discord `#review-portal` card format
3. **Legal/privacy**: Confirm redacted data handling complies with any applicable policies
4. **User research**: Survey 3-5 reviewers on workflow preferences before building
5. **Schema finalization**: Confirm `talk_submissions_4` migration strategy with existing data

---

## Appendix: Anonymous ID Generation

```typescript
// backend/anonymous-id.ts
import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I, O (ambiguous)
const nanoid = customAlphabet(alphabet, 4);

export function generateAnonymousId(): string {
  return `TALK-${nanoid()}`; // e.g., "TALK-7X3K"
}
```

Collision probability: With 4 characters from 32-char alphabet, ~1M unique IDs. For a meetup with <1000 submissions/year, collision risk is negligible. Add timestamp prefix for extra safety if needed: `TALK-2026-7X3K`.

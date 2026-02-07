# RFC: Organizer Co-Pilot

**Status:** Draft  
**Author:** AI Design Task  
**Date:** 2026-02-06  

---

## Executive Summary

**Organizer Co-Pilot** is an opt-in AI assistant that helps Rust NYC meetup organizers triage talk submissions, detect urgency, score against rubrics, generate weekly digests, and draft replies—all while preserving privacy and human oversight.

---

## 1. Problem Statement

Organizers currently face:

1. **Triage fatigue** — Manually reviewing each submission takes significant time
2. **Inconsistent evaluation** — Different organizers may weight criteria differently
3. **Missed deadlines** — Time-sensitive submissions (e.g., visiting speakers) slip through
4. **Slow response times** — Submitters wait days/weeks for feedback
5. **Context loss** — Discord threads grow long; key details get buried

---

## 2. Feature Overview

| Capability | Description | Trigger |
|------------|-------------|---------|
| **Rubric Scoring** | Auto-score submissions against configurable criteria (topic fit, novelty, clarity, speaker experience) | On submission |
| **Urgency Detection** | Flag time-sensitive signals (travel dates, deadlines, "visiting next week") | On submission |
| **Suggested Tags** | Propose labels: `lightning`, `deep-dive`, `beginner-friendly`, `advanced`, `needs-mentorship` | On submission |
| **Weekly Digest** | Summarize new submissions, pending decisions, upcoming deadlines | Scheduled (cron) |
| **Draft Replies** | Generate templated responses for common scenarios (accept, decline, request-more-info) | On-demand (slash command) |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Talk Submission                             │
│                    (backend/index.ts:POST /api/submissions)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       AI Co-Pilot Pipeline                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Rubric Score │→│ Urgency Flag │→│ Tag Suggest  │→│ Store Meta │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│             Discord Notification (enhanced)                         │
│   • Includes score badge, urgency flag, suggested tags              │
│   • Posts to #organizers channel                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 File Changes

| File | Changes |
|------|---------|
| `backend/copilot/` (new) | New module for AI analysis |
| `backend/copilot/rubric.ts` | Rubric scoring logic |
| `backend/copilot/urgency.ts` | Urgency detection |
| `backend/copilot/tags.ts` | Tag suggestions |
| `backend/copilot/digest.ts` | Weekly digest generation |
| `backend/copilot/replies.ts` | Draft reply templates |
| `backend/index.ts` | Integration hook after submission (lines ~100-150) |
| `shared/types.ts` | New `CopilotAnalysis` type |

### 3.3 Database Schema Extension

```sql
-- New table for AI analysis results
CREATE TABLE copilot_analyses_1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES talk_submissions_3(id),
  
  -- Rubric scores (0-100)
  score_topic_fit INTEGER,
  score_novelty INTEGER,
  score_clarity INTEGER,
  score_speaker_exp INTEGER,
  score_overall INTEGER,
  
  -- Urgency
  urgency_level TEXT CHECK(urgency_level IN ('none', 'low', 'medium', 'high')),
  urgency_reason TEXT,
  urgency_deadline DATE,
  
  -- Tags (JSON array)
  suggested_tags TEXT, -- ["lightning", "beginner-friendly"]
  
  -- Metadata
  model_version TEXT NOT NULL,
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Opt-out tracking
  organizer_override BOOLEAN DEFAULT FALSE,
  override_notes TEXT
);

-- Index for digest queries
CREATE INDEX idx_copilot_analyses_analyzed_at ON copilot_analyses_1(analyzed_at);
CREATE INDEX idx_copilot_analyses_urgency ON copilot_analyses_1(urgency_level);
```

---

## 4. Detailed Design

### 4.1 Rubric Scoring

**Prompt template** (configurable in `copilot/rubric.ts`):

```typescript
const RUBRIC_PROMPT = `You are evaluating a Rust NYC meetup talk submission.

SUBMISSION:
Speaker: {{speaker_name}}
Context: {{talk_context}}
Type: {{submission_type}}

Score each criterion 0-100:
1. Topic Fit: Is this relevant to the Rust community?
2. Novelty: Is this a fresh perspective or well-covered ground?
3. Clarity: Is the proposal clear about what will be presented?
4. Speaker Experience: Based on context, how prepared is the speaker?

Return ONLY valid JSON:
{
  "topic_fit": 85,
  "novelty": 70,
  "clarity": 90,
  "speaker_exp": 75,
  "reasoning": "Brief explanation"
}`;
```

**Scoring thresholds** (env-configurable):

| Score | Badge | Action |
|-------|-------|--------|
| 80+ | 🌟 Strong | Fast-track review |
| 60-79 | ✅ Solid | Normal queue |
| 40-59 | 🤔 Consider | May need mentorship |
| <40 | ⚠️ Needs Work | Request more info |

### 4.2 Urgency Detection

Pattern-based + AI hybrid approach:

```typescript
// backend/copilot/urgency.ts

// Fast regex patterns (no API call)
const URGENCY_PATTERNS = [
  { pattern: /visiting\s+(next|this)\s+week/i, level: 'high', reason: 'Visiting speaker' },
  { pattern: /deadline\s*(is\s+)?(\w+\s+\d+|\d+\/\d+)/i, level: 'medium', reason: 'Mentioned deadline' },
  { pattern: /time[- ]sensitive/i, level: 'medium', reason: 'Explicitly time-sensitive' },
  { pattern: /only\s+available\s+(on|until)/i, level: 'high', reason: 'Limited availability' },
  { pattern: /leaving\s+(the\s+)?(city|country|US)/i, level: 'high', reason: 'Departing soon' },
];

// If patterns don't match, use AI for nuanced detection
async function detectUrgencyWithAI(content: string): Promise<UrgencyResult> {
  // Uses gpt-4o-mini with specific urgency-detection prompt
}
```

### 4.3 Suggested Tags

Auto-suggested, organizer-confirmed:

```typescript
const TAG_TAXONOMY = {
  format: ['lightning', 'deep-dive', 'workshop', 'panel'],
  level: ['beginner-friendly', 'intermediate', 'advanced'],
  topic: ['async', 'systems', 'wasm', 'embedded', 'web', 'cli', 'gamedev'],
  support: ['needs-mentorship', 'needs-slides-review', 'first-time-speaker'],
};
```

Tags appear in Discord notification with ✅/❌ buttons for organizers to confirm.

### 4.4 Weekly Digest

Cron job (`copilot-digest.cron.ts`) runs Monday 9am:

```markdown
## 📊 Rust NYC Talk Submissions — Week of Feb 3

### 🆕 New Submissions (3)
| Speaker | Topic | Score | Urgency |
|---------|-------|-------|---------|
| Alice | Async Rust Deep Dive | 🌟 85 | ⏰ HIGH: visiting Feb 15 |
| Bob | My First Crate | 🤔 55 | — |
| Carol | WebAssembly Perf | ✅ 72 | — |

### ⏳ Pending Decisions (5)
- Alice's talk awaiting slot assignment (7 days)
- Bob's talk needs mentorship assignment (14 days)

### 📅 Upcoming Deadlines
- Feb 15: Alice only available this date
- Feb 28: March meetup speaker deadline

### 📈 Stats
- Avg response time: 4.2 days
- Acceptance rate: 67%
```

### 4.5 Draft Replies

Slash command `/copilot reply <submission-id> <scenario>`:

| Scenario | Template |
|----------|----------|
| `accept` | Congratulations, scheduling details, next steps |
| `decline` | Gracious decline, reasons, encouragement to resubmit |
| `more-info` | Specific questions based on what's missing |
| `mentorship` | Offer pairing with experienced speaker |

**Guardrail:** Draft is posted as an **ephemeral message** only visible to the organizer who invoked it. Organizer must explicitly send or edit before it's visible to the submitter.

---

## 5. Guardrails & Opt-In

### 5.1 Opt-In Model

| Level | Scope | How to Enable |
|-------|-------|---------------|
| **Guild-level** | Entire Discord server | Env var `COPILOT_ENABLED=true` |
| **Channel-level** | Specific submission channels | Channel topic includes `[copilot]` |
| **Submission-level** | Individual submission | Submitter checkbox "Allow AI-assisted review" |

**Default:** All levels default to **OFF**. Requires explicit opt-in.

### 5.2 Human-in-the-Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Output Classification                     │
├─────────────────────────────────────────────────────────────────┤
│ ADVISORY (shown to organizers only):                            │
│   • Rubric scores                                               │
│   • Urgency flags                                               │
│   • Tag suggestions                                             │
│   • Weekly digests                                              │
│   • Draft replies (ephemeral)                                   │
├─────────────────────────────────────────────────────────────────┤
│ NEVER autonomous:                                               │
│   • Accepting/declining submissions                             │
│   • Sending replies to submitters                               │
│   • Modifying submission content                                │
│   • Creating public channels                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Override Mechanism

Any organizer can override AI analysis:

```
/copilot override <submission-id> score=95 urgency=none tags=deep-dive,advanced
```

Overrides are logged with organizer ID, timestamp, and reason.

### 5.4 Rate Limiting

| Resource | Limit | Reason |
|----------|-------|--------|
| OpenAI calls per submission | 3 | Score + urgency + tags |
| OpenAI calls per day | 100 | Cost control |
| Digest generation | 1/week | Prevent spam |
| Draft replies per organizer | 20/day | Prevent abuse |

---

## 6. Data Storage & Privacy

### 6.1 What Data Is Stored

| Data | Stored | Retention | Purpose |
|------|--------|-----------|---------|
| Submission content | ✅ Yes | Indefinite | Core functionality |
| AI scores | ✅ Yes | Indefinite | Audit trail |
| AI reasoning | ✅ Yes | 90 days | Debugging |
| Full prompts sent to AI | ❌ No | — | Privacy |
| AI model responses | ✅ Yes (parsed) | 90 days | Debugging |
| Organizer overrides | ✅ Yes | Indefinite | Accountability |

### 6.2 What Data Is NOT Stored

- Raw API request/response bodies to OpenAI
- Conversation history beyond current submission
- Personal data beyond what's in submission form
- IP addresses or device fingerprints

### 6.3 Data Flow to Third Parties

```
┌──────────────────┐         ┌──────────────────┐
│  Our Database    │         │    OpenAI API    │
│  (Val Town SQL)  │         │  (gpt-4o-mini)   │
└────────┬─────────┘         └────────▲─────────┘
         │                            │
         │  Submission content        │ Anonymized prompt
         │  (speaker name,            │ (no email, no Discord IDs
         │   talk context)            │  in production prompts)
         └────────────────────────────┘
```

**OpenAI Data Policy:** Using API (not ChatGPT), data is not used for training per OpenAI API ToS.

---

## 7. Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Avg. response time** | 5 days | 2 days | Time from submission to first organizer reply |
| **Triage time per submission** | 10 min | 3 min | Organizer-reported (survey) |
| **Missed urgent submissions** | Unknown | 0 | Count of high-urgency not reviewed within 48h |
| **AI score correlation** | N/A | >0.7 | Correlation between AI score and final decision |
| **Organizer override rate** | N/A | <20% | Indicates AI alignment with organizer judgment |
| **Submitter satisfaction** | 4.0/5 | 4.5/5 | Post-event survey |

---

## 8. Mock Press Release

> ### **Rust NYC Launches AI-Powered Talk Submission Co-Pilot**
>
> *New opt-in feature helps organizers respond to speakers 60% faster while maintaining human decision-making*
>
> **New York, NY** — Rust NYC, the popular systems programming meetup, today announced the launch of **Organizer Co-Pilot**, an AI-assisted tool that helps volunteer organizers efficiently triage talk submissions without compromising privacy or human oversight.
>
> "Our organizers are volunteers with day jobs," said [Organizer Name]. "Co-Pilot handles the time-consuming first pass—scoring proposals, flagging visiting speakers who need fast responses, and drafting reply templates—so we can focus on the human conversations that matter."
>
> **Key Features:**
> - **Smart Scoring**: AI evaluates submissions against transparent rubrics, highlighting strong proposals
> - **Urgency Detection**: Automatically flags time-sensitive submissions (visiting speakers, deadlines)
> - **Weekly Digests**: Summarizes pending submissions so nothing falls through the cracks
> - **Draft Replies**: Generates starting points for common responses, always requiring human review before sending
>
> **Privacy by Design:**
> - Opt-in at every level (guild, channel, individual submission)
> - AI provides recommendations only—humans make all decisions
> - No personal data stored beyond submission content
> - Full audit trail of AI suggestions vs. human decisions
>
> The feature is available immediately for Rust NYC and will be open-sourced for other meetup organizers.

### FAQ (Privacy & Trust)

**Q: Does the AI automatically accept or reject talks?**  
A: No. The AI provides scores and suggestions visible only to organizers. All accept/decline decisions require explicit human action.

**Q: Is my submission data used to train AI models?**  
A: No. We use OpenAI's API, which does not use API data for training. Submission content is processed but not retained by OpenAI.

**Q: Can I opt out of AI analysis?**  
A: Yes. Submitters can uncheck "Allow AI-assisted review" on the form. Organizers can disable Co-Pilot at the channel or guild level.

**Q: What if the AI score is wrong?**  
A: Organizers can override any AI analysis with one command. Overrides are logged for continuous improvement.

**Q: Who can see AI scores?**  
A: Only organizers with access to the #organizers channel. Scores are never shared with submitters.

**Q: Is the scoring rubric transparent?**  
A: Yes. The rubric criteria and weights are documented and can be customized per community.

---

## 9. Implementation Phases

| Phase | Scope | Duration | Dependencies |
|-------|-------|----------|--------------|
| **Phase 1** | Rubric scoring + urgency detection | 2 weeks | None |
| **Phase 2** | Suggested tags + enhanced Discord notifications | 1 week | Phase 1 |
| **Phase 3** | Weekly digest cron job | 1 week | Phase 1 |
| **Phase 4** | Draft replies slash command | 2 weeks | Discord slash command registration |
| **Phase 5** | Organizer dashboard (optional) | 3 weeks | All phases |

---

## 10. Existing Code Patterns to Reuse

The autothread module (`backend/autothread/logic.ts`) provides proven patterns:

| Pattern | Location | Reuse For |
|---------|----------|-----------|
| OpenAI integration | `logic.ts:100-160` (`generateAIThreadName`) | All AI calls |
| JSON response parsing | `logic.ts:130-145` | Score/tag parsing |
| Prompt construction | `logic.ts:105-125` | Rubric prompts |
| Error handling | `logic.ts:150-160` | Graceful degradation |
| Mode guards (plan/dry_run/live) | `logic.ts:200-250` | Testing without side effects |
| Namespace isolation | `store.ts` | Sandbox testing of Co-Pilot |

---

## 11. Remaining Work

For orchestrator follow-up:

1. **Create `backend/copilot/` module structure** with type definitions
2. **Implement rubric scoring** (highest value, lowest complexity)
3. **Add `copilot_analyses` table** migration
4. **Integration test** with existing submission flow
5. **Discord notification enhancement** with score badges
6. **Cron job** for weekly digest
7. **Slash command** registration for `/copilot` commands

---

## Appendix A: Example Discord Notification (Enhanced)

```
📢 **New Talk Submission**

**Speaker:** Alice Chen
**Topic:** Building a Custom Async Runtime in Rust

**🤖 Co-Pilot Analysis:**
┌─────────────────────────────────────────┐
│ Score: 🌟 85/100                        │
│ ├─ Topic Fit: 92                        │
│ ├─ Novelty: 78                          │
│ ├─ Clarity: 88                          │
│ └─ Speaker Exp: 82                      │
│                                         │
│ ⏰ URGENCY: HIGH                         │
│ └─ "Visiting NYC Feb 12-16 only"        │
│                                         │
│ Tags: `deep-dive` `async` `advanced`    │
└─────────────────────────────────────────┘

[View Submission] [Override Analysis] [Draft Reply]
```

---

## Appendix B: Configuration Reference

```typescript
// Environment variables
COPILOT_ENABLED=true|false           // Master switch
COPILOT_MODEL=gpt-4o-mini            // AI model
COPILOT_DAILY_LIMIT=100              // API call cap
COPILOT_SCORE_THRESHOLD_STRONG=80    // Fast-track threshold
COPILOT_SCORE_THRESHOLD_WEAK=40      // Needs-work threshold
COPILOT_DIGEST_DAY=1                 // 0=Sun, 1=Mon, etc.
COPILOT_DIGEST_HOUR=9                // Hour in UTC
```

---

*End of RFC*

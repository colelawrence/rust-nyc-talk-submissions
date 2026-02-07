# TalkTriage — Working Backwards PR/FAQ (Amazon-style)

> **Decisions captured from product direction**
> 1) **Dedicated channel** for organizer triage (new, separate from general organizers chat)
> 2) **Role-gated** access based on a configurable set of Discord role IDs
> 3) **Finalize button** lives in the card’s thread (fallback: on the card if thread can’t be created)
> 4) Default **recommendation threshold = 3 votes**, configurable

---

## Press Release (Draft)

**FOR IMMEDIATE RELEASE**

## Rust NYC launches TalkTriage — review talks where you already talk

**A Discord-native triage inbox with role-gated voting, threaded discussion, and one-click final decisions.**

**New York, NY —** Rust NYC today announced **TalkTriage**, a Discord-native review pipeline that replaces ad-hoc spreadsheets and scattered DMs with a dedicated organizer inbox channel inside Discord. When a speaker submits a talk, TalkTriage posts a structured “review card” into a private triage channel where organizers can vote with one click, open a focused discussion thread, and finalize a decision—without leaving the place they already coordinate.

Volunteer organizing teams are often limited not by the quality of their communities, but by the overhead of triaging submissions. TalkTriage reduces that overhead by turning every submission into a single source of truth: the abstract, links to the speaker discussion channel, the live vote tally, and decision history.

TalkTriage is **role-gated** so only authorized reviewers can vote or finalize decisions. Once a decision is finalized, the bot automatically posts a clear status update into the speaker’s submission channel—reducing uncertainty and ensuring speakers get timely feedback.

> “We wanted a workflow that felt native to Discord. TalkTriage doesn’t add another tool—it turns Discord into the tool.”
> — Rust NYC organizers

**Availability:** TalkTriage will roll out first to Rust NYC’s organizer team. The initial release focuses on the triage inbox, voting + tallying, and thread-based decision finalization. Scheduling handoff and analytics will follow as separate phases.

---

## The Customer Problem

### Primary customer: Organizers (reviewers)
**Job to be done:** “Keep the queue moving, align as a team, and make decisions quickly—with minimal overhead.”

**Pain today:**
- Review state lives in a spreadsheet or someone’s memory
- Votes are unstructured (hard to tally, hard to audit)
- Discussion fragments across channels and DMs
- Submissions stall because urgency isn’t visible

### Secondary customer: Speakers (indirectly)
**Job to be done:** “Know my talk was seen, understand what happens next, and get a timely answer.”

---

## The Solution (1 sentence)

**TalkTriage is a dedicated, role-gated Discord triage inbox where submissions become review cards with one-click voting, a linked discussion thread, and a finalize button that turns consensus into action.**

---

## Product Surfaces Touched (Inventory)

### Discord (Organizer)
1) **New channel:** `#talk-triage` (dedicated inbox)
2) **Review card message** in `#talk-triage` with interactive controls
3) **Thread per card** for deliberation (created on-demand)
4) **Action panel message** inside the thread (contains Finalize buttons)
5) **Slash commands (MVP):**
   - `/triage` — show queue (grouped by status + aging)
   - `/talk <id>` — view details + jump links (optional MVP; can be phase 1.5)

### Discord (Speaker)
6) **Existing:** speaker submission channel (already created today)
7) **New:** status update messages posted into the speaker channel when finalized (and optionally when moved into “Under review”)

### Backend (Val Town / Hono)
8) **New route:** `POST /api/discord/interactions` (Discord Interactions webhook)
9) **New internal API endpoints** (optional; for debugging/backfills)

### Data (SQLite)
10) New tables for votes/status/history + mapping submission ↔ review card message ↔ thread

### Config (env)
11) New env vars for triage channel + reviewer roles + thresholds

---

## North Star Experience (Detailed)

### 0) A submission arrives
Existing flow remains:
- DB insert
- speaker channel created
- welcome message posted

**New addition:** also create a TalkTriage review card in `#talk-triage`.

### 1) TalkTriage posts a Review Card
A single message containing:
- Submission ID
- Speaker + on-behalf info
- Abstract excerpt
- Link to speaker discussion channel
- Status badge
- Live vote tally

**Controls on the card:**
- Vote buttons: ✅ Accept, 🤔 Maybe, ❌ Pass
- “Discuss” button: 💬 creates/opens thread

### 2) Reviewers vote
- Each vote is **per-reviewer** (updatable)
- Card edits to show live tally
- When tally meets the configurable threshold (default: ≥3 Accept votes), card shows “Recommendation: Accept (threshold met)”

### 3) Discussion happens in the thread
- Clicking **Discuss** creates a thread (if possible) and posts an **Action Panel** message
- The action panel contains **Finalize** buttons (see below)

### 4) Finalize decision (button)
The action panel includes:
- **Finalize: Accept**
- **Finalize: Waitlist**
- **Finalize: Decline**

Finalizing:
- Updates DB status
- Edits review card status badge + pins final state in thread
- Posts a status update into the speaker channel

**Fallback:** if thread creation fails, the finalize buttons are posted directly on the review card message.

### 5) `/triage` shows the queue
`/triage` returns an organizer-only view:
- Grouped by status (Pending / Under Review / Accepted / Waitlist / Declined)
- Sorted by aging and/or score
- Each row: ID, speaker, age, tally summary, links

---

## Interaction Design (Concrete Message Layouts)

### Review Card (in `#talk-triage`)

**Message content (example):**

**🎤 Talk Submission #42**  \  **Status:** `Pending`

**Speaker:** Jane Doe  
**Submission:** Submitted by speaker (or “on behalf of …”)

**Abstract (excerpt):**
> Rust lifetimes are hard—this talk explains… (first 400–800 chars)

**Speaker channel:** <#123456789012345678>

**Votes:** ✅ 2  ·  🤔 1  ·  ❌ 0  
**Recommendation:** *(not yet)*

**Components (buttons):**
- Row 1: ✅ Accept | 🤔 Maybe | ❌ Pass
- Row 2: 💬 Discuss

Notes:
- We intentionally keep “Finalize” out of the main card in the happy path to reduce accidental clicks; finalization lives in the thread action panel.

### Action Panel (posted in the thread)

**Header:** “Decision panel for Talk #42”

Shows:
- Current tally + recommendation
- Current status
- A reminder: “Finalizing will notify the speaker channel.”

**Buttons:**
- Finalize: ✅ Accept
- Finalize: 🟨 Waitlist
- Finalize: ❌ Decline

Optional (later): “Request more info” button that posts a template in speaker channel.

---

## Role-Gating & Permissions

### Requirement
Only users with at least one of the configured roles may:
- vote
- open a discussion thread (optional gating)
- finalize decisions
- view `/triage` output

### Proposed configuration
- `DISCORD_REVIEWER_ROLE_IDS` — comma-separated list of role IDs
- `DISCORD_TRIAGE_CHANNEL_ID` — where review cards are posted

### Enforcement mechanism (Discord Interactions)
Discord interaction payloads include `member.roles` for guild interactions. We check:
- is request valid (signature verification)
- is in expected guild
- is user role-authorized

If unauthorized:
- respond ephemerally: “You don’t have permission to use TalkTriage actions.”

---

## Vote Thresholds (Configurable)

### Defaults
- “Recommendation: Accept” when **Accept votes ≥ 3**

### Configuration
- `TALKTRIAGE_MIN_ACCEPT_VOTES` (default `3`)
- Optional additional constraints (future):
  - require N total votes
  - block recommendation if any ❌ votes exist

Important: thresholds should influence **recommendation** and/or enabling finalize buttons, but finalization is always explicit and role-gated.

---

## Data Model (Proposed)

### `talk_review_cards_1`
Maps a submission to its review card message/thread.
- `submission_id` (PK)
- `triage_channel_id`
- `review_message_id`
- `review_thread_id` (nullable)
- `created_at`

### `talk_reviews_1`
One vote per reviewer per submission.
- `submission_id`
- `reviewer_discord_id`
- `vote` enum: `accept | maybe | pass`
- `updated_at`
- UNIQUE(`submission_id`, `reviewer_discord_id`)

### `talk_status_1`
Current status.
- `submission_id` (PK)
- `status` enum: `pending | reviewing | accepted | waitlist | declined`
- `updated_at`
- `updated_by_discord_id`

### `talk_status_history_1` (recommended)
Append-only audit trail.
- `id`
- `submission_id`
- `from_status`, `to_status`
- `changed_by_discord_id`
- `note` (nullable)
- `created_at`

---

## State Machine (Lifecycle)

### States
- `pending` (default)
- `reviewing`
- `accepted`
- `waitlist`
- `declined`

### Transitions
- `pending → reviewing` (optional automatic when first vote arrives)
- `pending/reviewing → accepted | waitlist | declined` (finalize)
- `accepted/waitlist/declined → reviewing` (admin override only; logs history)

---

## Speaker Notifications (Copy)

When finalizing, post into the speaker channel:

- **Accepted:**
  “🎉 Your talk has been **accepted**! Next we’ll coordinate scheduling in this channel.”

- **Waitlist:**
  “🟨 Your talk is on the **waitlist**. We loved it—timing and slots are the only constraint. We’ll update you as soon as we can.”

- **Declined:**
  “Thank you for submitting. This one isn’t the right fit for our upcoming slots, but we’d love to see you submit again. If you’d like feedback, reply here.”

(Exact tone TBD by Rust NYC.)

---

## FAQ

### Q: Why a dedicated `#talk-triage` channel?
It separates high-signal review activity from general organizer chat, and gives an always-up-to-date “inbox” view. It also makes permissioning and automation simpler.

### Q: Why role-gating instead of channel privacy alone?
Role-gating protects against accidental permissions drift, makes it safe to share the triage channel with non-review organizers (e.g., logistics), and enables consistent enforcement on all interactive actions.

### Q: Why finalize in the thread?
Final decisions are the highest-risk action. Putting finalize controls in the thread reduces accidental clicks, encourages discussion, and gives a clear audit trail next to the rationale.

### Q: What if threads aren’t possible?
If Discord thread creation fails (permissions or configuration), TalkTriage falls back to placing finalize buttons directly on the review card.

### Q: Is the ≥3 threshold mandatory?
No—thresholds are configurable. The system uses thresholds to inform recommendations and (optionally) to enable finalize buttons, but humans can still finalize explicitly.

---

## Implementation Notes (Technical Feasibility)

This design intentionally uses **Discord Interactions** (HTTP callbacks) rather than emoji reaction events that typically require a persistent Gateway connection.

**Net-new capabilities needed in code:**
- Add a Discord interactions endpoint and signature verification (`DISCORD_PUBLIC_KEY`)
- Extend `DiscordService.sendMessage()` to support embeds + components (buttons), not just plain text
- Add DB tables listed above
- Add handlers for:
  - button clicks (vote, discuss, finalize)
  - `/triage` command

---

## Open Questions (for vNext)

1) Do we want “Request more info” as a standardized workflow (templates, SLA timers)?
2) Do we want consensus rules beyond simple thresholds (e.g., require no ❌ votes)?
3) Should finalization require a confirmation modal?
4) Should we show “review participation” nudges (e.g., ping reviewers if no votes after 48h)?


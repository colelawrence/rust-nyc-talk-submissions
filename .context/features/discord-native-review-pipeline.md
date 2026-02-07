# Feature Concept: Discord-Native Review Pipeline

## TL;DR

**Feature Name: TalkTriage** — _Review talks where you already talk_

A Discord-native review pipeline that lets event organizers triage, discuss, score, and decide on talk submissions entirely within Discord using reactions, slash commands, and automated status tracking.

---

## The Problem

Rust NYC (and similar meetups) receives talk submissions via a web form. A Discord channel is auto-created for each submission, but **organizer review happens outside Discord**:

- Organizers maintain a separate spreadsheet to track status
- Voting happens in ad-hoc DMs or calls
- Status updates require manual cross-referencing
- Context-switching between Discord ↔ spreadsheet kills momentum

**Result:** Submissions go stale, speakers wait weeks for responses, and organizers lose track.

---

## North-Star User Experience (5 Steps)

1. **📨 Submission arrives** → Bot posts a "review card" to `#organizer-inbox` with speaker name, abstract, and reaction buttons (✅ 🤔 ❌ 📅)

2. **🗳️ Organizers react** → Each reaction is a vote. After 3+ votes, bot auto-updates the card with a tally: "2 Accept, 1 Maybe, 0 Reject"

3. **🧵 Discussion happens in threads** → Clicking "Discuss" (💬 reaction) opens a thread from the card. All context stays together.

4. **📊 `/triage` shows the queue** → Running `/triage` shows a ranked list: talks sorted by score, grouped by status (Pending, Under Review, Accepted, Waitlist, Declined)

5. **🎯 `/talk status <id>` controls the lifecycle** → Organizers run `/talk accept 42` to accept talk #42. Bot auto-notifies the speaker in their channel: "🎉 Your talk has been accepted for April 15th!"

---

## Why It's Uniquely Valuable vs. Spreadsheets

| Spreadsheet Pain | TalkTriage Solution |
|------------------|---------------------|
| Context-switching to view abstracts | Review card embeds full context inline |
| Manual vote tallying | Real-time reaction aggregation |
| Status out of sync with reality | Single source of truth in Discord |
| Speaker notification is manual | Automated lifecycle notifications |
| Hard to see who reviewed what | Transparent voting with organizer attribution |
| No audit trail | Threaded discussion persisted forever |

**Killer differentiator:** Organizers never leave Discord. The tool is invisible — it's just reactions and two slash commands.

---

## Architecture Overview

### New Capabilities Required

| Capability | Implementation | File Impact |
|------------|----------------|-------------|
| Review card embeds | Rich embed with reactions | `backend/messages.ts` L1-80 |
| Reaction tracking | Webhook or polling + state | New: `backend/reactions.ts` |
| Vote tallying | SQLite table for votes | `backend/index.ts` new table |
| `/triage` command | Discord slash command | New: `backend/commands/triage.ts` |
| `/talk` command | Discord slash command suite | New: `backend/commands/talk.ts` |
| Status lifecycle | State machine per talk | New: `backend/talk-state.ts` |
| Speaker notifications | Extend `welcomeMessage` flow | `backend/messages.ts` |

### Database Schema Extension

```sql
CREATE TABLE talk_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  organizer_discord_id TEXT NOT NULL,
  vote TEXT CHECK(vote IN ('accept', 'maybe', 'reject', 'schedule')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES talk_submissions_3(id),
  UNIQUE(submission_id, organizer_discord_id)
);

CREATE TABLE talk_status (
  submission_id INTEGER PRIMARY KEY,
  status TEXT CHECK(status IN ('pending', 'reviewing', 'accepted', 'waitlist', 'declined', 'scheduled')),
  scheduled_date DATE,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  FOREIGN KEY (submission_id) REFERENCES talk_submissions_3(id)
);
```

### Reaction Mapping

| Emoji | Vote | Meaning |
|-------|------|---------|
| ✅ | `accept` | I want this talk |
| 🤔 | `maybe` | Needs discussion |
| ❌ | `reject` | Not a fit |
| 📅 | `schedule` | Ready to schedule now |
| 💬 | — | Open discussion thread |

---

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Time-to-first-review | Unknown (no tracking) | < 48 hours |
| Time-to-decision | ~2 weeks (estimate) | < 7 days |
| Review participation rate | Unknown | 100% of organizers |
| Speaker satisfaction (survey) | N/A | 4.5+ / 5 |
| Spreadsheet usage | Primary tool | Eliminated |

**Leading indicator:** Number of reactions per submission within 24 hours of posting.

---

## Mock Press Release

### Headline

**Rust NYC Meetup Eliminates Review Spreadsheets with Discord-Native Talk Triage**

### Subhead

_New open-source tool lets event organizers review, vote, and accept talk submissions without leaving Discord_

### Paragraph 1

**NEW YORK, NY** — Rust NYC today announced TalkTriage, a Discord-native review pipeline that replaces spreadsheets and email threads with emoji reactions and slash commands. Event organizers can now review talk submissions, vote on acceptance, and notify speakers — all within the Discord server where their community already lives.

### Paragraph 2

TalkTriage solves a persistent pain point for tech meetups: the context-switching tax of managing submissions. When a talk is submitted via the existing web form, a "review card" automatically appears in a private organizer channel. Organizers vote with reaction emojis (✅ to accept, 🤔 to discuss, ❌ to pass). The bot tallies votes in real time and, when consensus is reached, a single slash command (`/talk accept 42`) updates the status and notifies the speaker — no spreadsheet required.

### Paragraph 3

"We were drowning in tabs," said Cole Lawrence, Rust NYC organizer. "Discord for discussion, Google Sheets for tracking, email for speaker updates. TalkTriage collapses all of that into reactions and two commands. Our time-to-decision dropped from two weeks to under four days."

### Quote

> "The best workflow tool is the one you don't notice. TalkTriage is invisible — it's just Discord, but now it does the job of three other tools."
>
> — Cole Lawrence, Rust NYC Organizer

### FAQ Bullets

- **Q: Does this require a separate bot?**  
  A: No. TalkTriage extends the existing Rust NYC submission bot with new capabilities.

- **Q: Can speakers see organizer votes?**  
  A: No. The `#organizer-inbox` channel is private. Speakers only see status updates in their own channel.

- **Q: What if we disagree?**  
  A: The 💬 reaction opens a threaded discussion on the review card. Resolve it there, then vote.

- **Q: Can we customize the voting threshold?**  
  A: Yes. Configure the minimum votes required to auto-suggest a decision (default: 3).

- **Q: Is this open source?**  
  A: Yes. The full implementation is available at [github.com/colelawrence/rust-nyc-talk-submissions](https://github.com/colelawrence/rust-nyc-talk-submissions).

---

## Remaining Work

For the orchestrator to hand off:

1. **Design slash command registration flow** — Discord requires registering commands with the API; determine if we use guild-specific or global commands
2. **Choose reaction tracking strategy** — Gateway (websocket) vs. polling vs. interaction webhooks
3. **Define permission model** — Who can run `/talk accept`? Role-based?
4. **Create embed message templates** — Design the review card visual layout
5. **Write migration script** — Backfill existing submissions into `talk_status`
6. **Integration tests** — Test reaction → vote → status lifecycle end-to-end

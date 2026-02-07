# 🗓️ Feature Concept: Seasons & Templates

**Status**: PR-Ready Concept  
**Feature Name**: **Seasons & Templates** (internal codename: `seasons-v1`)

---

## Executive Summary

**Seasons & Templates** transforms the talk submission system from a simple form into a **repeatable event management platform**. Even for a single meetup like Rust NYC, this feature future-proofs the system by organizing submissions into time-bound "seasons" with configurable deadlines, reusable templates, and automatic archival.

---

## Why This Matters (Even for One Meetup)

| Pain Point Today | How Seasons Solves It |
|------------------|----------------------|
| Channel names use `nodate-` prefix (see `backend/index.ts:79`) | Channels include event date: `2026-mar-15-rust-nyc-talk` |
| No deadline enforcement | Clear CFP open/close dates displayed to submitters |
| Old submissions clutter the Discord category | Auto-archive past season channels to archive category |
| No way to compare submission volumes across events | Built-in per-season analytics |
| Setup is manual each time | Templates capture your proven format for 1-click season creation |

---

## User Journey: Setting Up a New Season

### 1. Organizer Creates a Template (One-Time)

```
/admin → Templates → Create Template

Template Name: "Monthly Rust NYC Meetup"
Default Duration: 4 weeks CFP window
Channel Naming: {date}-{submission_id}-{speaker}
Welcome Message: [Custom markdown with {{speaker}}, {{deadline}} variables]
Organizer Roles: @rust-nyc-organizers
Archive Category: "Past Events"
```

### 2. Organizer Creates a Season from Template

```
/admin → Seasons → New Season

Select Template: "Monthly Rust NYC Meetup"
Event Name: "Rust NYC March 2026"
Event Date: March 15, 2026
CFP Opens: February 1, 2026
CFP Closes: March 1, 2026 11:59pm EST
[Create Season]
```

### 3. Submitters See Active Season

The submission form now shows:
- **Event**: Rust NYC March 2026
- **Deadline**: 12 days remaining (closes March 1)
- **Status badge**: 🟢 Accepting Submissions

### 4. After Deadline: Automatic Transition

```
March 2, 2026 12:00am:
  ├── Form shows: "CFP closed for March event. Next event: April 2026"
  ├── Existing channels remain active for speaker coordination
  └── Discord channels moved to archive category after event date
```

---

## Key Capabilities

### 1. Season Management

| Capability | Description |
|------------|-------------|
| **Multi-season support** | Run overlapping CFPs (March event open while finalizing February) |
| **State machine** | `draft` → `open` → `closed` → `event_complete` → `archived` |
| **Deadline enforcement** | Form blocks submissions after `cfp_closes_at` |
| **Timezone-aware** | Store all dates in UTC, display in organizer's configured TZ |

### 2. Templates

| Capability | Description |
|------------|-------------|
| **Reusable configurations** | Save CFP duration, messages, Discord settings |
| **Variable substitution** | `{{speaker}}`, `{{deadline}}`, `{{event_name}}`, `{{event_date}}` |
| **Template versioning** | Copy template before editing to preserve history |
| **Quick clone** | "Create next month's event from this season" |

### 3. Discord Integration Enhancements

| Capability | Description |
|------------|-------------|
| **Per-season categories** | Each season gets its own Discord category |
| **Date-prefixed channels** | `2026-mar-15-rust-nyc-talk` instead of `nodate-1-speaker` |
| **Auto-archive** | Move channels to archive category after `event_date + 7 days` |
| **Deadline reminders** | Optional bot message: "CFP closes in 48 hours!" |

### 4. Analytics Dashboard

| Metric | Query |
|--------|-------|
| Submissions per season | `SELECT season_id, COUNT(*) FROM submissions GROUP BY season_id` |
| Submission velocity | Daily submission rate during CFP window |
| Conversion funnel | Submissions → Scheduled → Presented |
| Template performance | Which templates generate more submissions? |

---

## Data Model Changes

### New Tables

```sql
-- Templates table
CREATE TABLE season_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  default_cfp_duration_days INTEGER DEFAULT 28,
  channel_name_pattern TEXT DEFAULT '{date}-{id}-{speaker}',
  welcome_message_template TEXT,
  discord_category_pattern TEXT,
  archive_category_id TEXT,
  organizer_role_ids TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seasons table  
CREATE TABLE seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER REFERENCES season_templates(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  event_date DATE NOT NULL,
  cfp_opens_at DATETIME NOT NULL,
  cfp_closes_at DATETIME NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','open','closed','event_complete','archived')),
  discord_category_id TEXT,
  discord_archive_category_id TEXT,
  metadata TEXT, -- JSON for extensibility
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Modify existing submissions table
ALTER TABLE talk_submissions_3 ADD COLUMN season_id INTEGER REFERENCES seasons(id);
```

### Channel Naming Update

**Current** (`backend/index.ts:79`):
```typescript
const channelName = `nodate-${submissionId}-${sanitizeChannelName(speakerName)}`;
```

**Proposed**:
```typescript
const season = await getActiveSeason();
const eventDate = format(season.event_date, 'yyyy-MMM-dd').toLowerCase();
const channelName = `${eventDate}-${submissionId}-${sanitizeChannelName(speakerName)}`;
// Result: "2026-mar-15-42-alice-smith"
```

---

## API Endpoints

### Templates
- `GET /api/admin/templates` - List all templates
- `POST /api/admin/templates` - Create template
- `PUT /api/admin/templates/:id` - Update template
- `DELETE /api/admin/templates/:id` - Delete template

### Seasons
- `GET /api/seasons` - List seasons (public: shows active/upcoming)
- `GET /api/seasons/active` - Get currently accepting season
- `POST /api/admin/seasons` - Create season from template
- `PUT /api/admin/seasons/:id` - Update season
- `POST /api/admin/seasons/:id/transition` - Change status

### Submissions (Modified)
- `POST /api/submissions` - Now requires active season, auto-assigns `season_id`
- `GET /api/submissions?season_id=X` - Filter by season

---

## Frontend Changes

### Submission Form Updates

```tsx
// frontend/components/TalkSubmissionForm.tsx

// Add season context display
<div className="season-banner">
  <h2>{activeSeason.name}</h2>
  <p>Event Date: {formatDate(activeSeason.event_date)}</p>
  <p>Submissions close: {formatDeadline(activeSeason.cfp_closes_at)}</p>
  <CountdownTimer deadline={activeSeason.cfp_closes_at} />
</div>

// Form disabled state when CFP closed
{!activeSeason && (
  <div className="cfp-closed">
    <p>No events are currently accepting talk submissions.</p>
    <p>Next event: {nextSeason?.name || 'TBA'}</p>
  </div>
)}
```

### New Admin Dashboard

```
/admin
├── /admin/seasons           # Season list with status badges
├── /admin/seasons/:id       # Season detail + submission list
├── /admin/seasons/new       # Create from template
├── /admin/templates         # Template management
└── /admin/analytics         # Cross-season metrics
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Submission increase** | +20% vs pre-deadline baseline | Compare submission velocity in final 48h of CFP |
| **Organizer time saved** | 30 min/event | Survey: time to set up new event |
| **Template reuse rate** | >80% of seasons use templates | `seasons with template_id / total seasons` |
| **Archive completion** | 100% auto-archived within 14 days | Cron job success rate |
| **Deadline compliance** | 0 post-deadline submissions | Form rejection count |

---

## Mock Press Release Outline

### Headline
**Rust NYC Launches Seasons & Templates: Making Community Events Repeatable**

### Subheadline
*New feature brings deadline-driven CFPs and one-click event setup to the talk submission platform*

### Opening Paragraph
Today, Rust NYC announces Seasons & Templates, a new capability in their talk submission system that transforms ad-hoc event planning into a streamlined, repeatable process. Organizers can now create reusable templates, set clear CFP deadlines, and let automation handle channel archival.

### Problem Statement
Running recurring meetups means repeating the same setup steps every month. Organizers manually create Discord categories, update welcome messages, and remind themselves when to close submissions. Submitters often miss deadlines because there's no visible countdown.

### Solution
Seasons & Templates introduces:
- **Templates**: Save your event format once, reuse forever
- **Deadline enforcement**: CFP windows with visible countdowns
- **Auto-archive**: Past events automatically organized
- **Analytics**: Track submission trends across events

### Customer Quote
*"Before Seasons, every monthly meetup felt like starting from scratch. Now I click 'Create Season', pick next month's date, and the system handles the rest."* — Rust NYC Organizer

### Call to Action
Start using Seasons today at your next meetup. Visit [docs link] to set up your first template.

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Create `seasons` and `season_templates` tables
- [ ] Add `season_id` to submissions table
- [ ] Implement `getActiveSeason()` helper
- [ ] Update channel naming with event date

### Phase 2: Admin API (Week 2-3)
- [ ] Template CRUD endpoints
- [ ] Season CRUD + status transitions
- [ ] Season-filtered submission queries

### Phase 3: Frontend Integration (Week 3-4)
- [ ] Season banner on submission form
- [ ] Deadline countdown component
- [ ] "CFP Closed" state handling
- [ ] Basic admin dashboard

### Phase 4: Automation (Week 4-5)
- [ ] Cron job for status transitions (open→closed at deadline)
- [ ] Auto-archive cron (move channels after event)
- [ ] Optional deadline reminder messages

### Phase 5: Analytics & Polish (Week 5-6)
- [ ] Cross-season analytics dashboard
- [ ] Template variable substitution engine
- [ ] Documentation and testing

---

## Remaining Work

If this concept is approved, the orchestrator should:

1. **Create database migration file** at `backend/database/migrations/001_seasons.ts`
2. **Implement Season service** at `backend/services/season.ts` with:
   - `getActiveSeason()`, `createSeasonFromTemplate()`, `transitionSeasonStatus()`
3. **Add admin authentication** (required for admin endpoints)
4. **Design countdown timer component** for deadline display
5. **Set up cron trigger** for deadline enforcement and archival
6. **Update Discord channel creation** in `backend/index.ts:79-85` to use season dates

---

## References

- Current channel naming: `backend/index.ts:79`
- Current submission flow: `backend/index.ts:55-114`
- Discord integration: `backend/discord.ts`
- Database table: `talk_submissions_3` in `backend/index.ts:25-34`

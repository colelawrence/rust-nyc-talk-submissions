# Speaker Launchpad: Mentorship & First-Time Speaker Accelerator

**Status:** PR-Ready Concept  
**Feature Code Name:** `speaker-launchpad`  
**Target:** Rust NYC Meetup Talk Submission System

---

## Executive Summary

**Speaker Launchpad** transforms the talk submission process from a form-and-pray experience into a guided journey. First-time speakers get paired with experienced community mentors, receive structured support, and dramatically increase their odds of delivering a successful talk.

---

## 1. Feature Name & Positioning

**Primary Name:** Speaker Launchpad  
**Tagline:** "From idea to stage, you're never alone."

**Why this name:**
- "Launchpad" evokes preparation, support, and successful takeoff
- Avoids clinical "mentorship program" language
- Implies action and momentum, not just passive guidance

---

## 2. How Matching Works

### 2.1 Speaker Opt-In (Consent-First Design)

**Form Changes** (`frontend/components/TalkSubmissionForm.tsx`, lines 12-17):

Add to `SubmissionData` interface:
```typescript
interface SubmissionData {
  // ... existing fields
  isFirstTimeSpeaker: boolean;        // New: self-identification
  wantsMentorship: boolean;           // New: explicit opt-in
  preferredSupportType: SupportType;  // New: granularity
  speakerTimezone?: string;           // New: for async matching
}

type SupportType = 
  | 'full-mentorship'      // Full journey: ideation → delivery
  | 'proposal-review'      // Just help refining the abstract
  | 'dry-run-only'         // Practice presentation feedback
  | 'async-feedback'       // Written feedback, no calls
```

**UI Addition:** After the "Talk Context" field (around line 65), add:
```tsx
{/* First-Time Speaker Section */}
<div className="bg-[var(--bg-tertiary)] border border-[var(--accent-primary)] rounded p-4 mt-4">
  <div className="flex items-center mb-3">
    <span className="text-xl mr-2">🚀</span>
    <span className="font-mono font-medium text-primary">Speaker Launchpad</span>
  </div>
  
  <div className="space-y-3">
    <label className="flex items-center">
      <input type="checkbox" ... />
      <span className="ml-2 text-sm">This is my first conference/meetup talk</span>
    </label>
    
    {isFirstTimeSpeaker && (
      <label className="flex items-center">
        <input type="checkbox" ... />
        <span className="ml-2 text-sm">I'd like to be matched with a mentor</span>
      </label>
    )}
    
    {wantsMentorship && (
      <select ...>
        <option value="full-mentorship">Full mentorship journey</option>
        <option value="proposal-review">Help with my proposal only</option>
        <option value="dry-run-only">Practice run feedback</option>
        <option value="async-feedback">Written feedback (async)</option>
      </select>
    )}
  </div>
</div>
```

### 2.2 Mentor Opt-In (Workload Management)

**Mentor Pool Management:**

```typescript
// New table: mentor_availability
interface MentorRecord {
  id: number;
  discord_user_id: string;
  display_name: string;
  max_mentees_per_quarter: number;  // Workload cap
  current_mentee_count: number;
  expertise_areas: string[];         // e.g., ["systems", "web", "async"]
  support_types_offered: SupportType[];
  timezone: string;
  active: boolean;
  created_at: string;
}
```

**Workload Protection Rules:**
1. **Hard cap:** Mentors set their own quarterly limit (default: 2)
2. **Cooldown:** After completing a mentorship, 2-week pause before new match
3. **Opt-out anytime:** Mentors can mark themselves unavailable
4. **Load balancing:** System prefers mentors with fewer active mentees

### 2.3 Matching Algorithm

```typescript
function findBestMentor(submission: SubmissionWithLaunchpad): MentorRecord | null {
  const candidates = await getMentorsWithCapacity();
  
  return candidates
    .filter(m => m.support_types_offered.includes(submission.preferredSupportType))
    .filter(m => hasTimezoneOverlap(m.timezone, submission.speakerTimezone))
    .sort((a, b) => {
      // Prefer mentors with matching expertise
      const aMatch = expertiseScore(a, submission.talkContext);
      const bMatch = expertiseScore(b, submission.talkContext);
      if (aMatch !== bMatch) return bMatch - aMatch;
      
      // Then prefer less-loaded mentors
      return a.current_mentee_count - b.current_mentee_count;
    })[0] ?? null;
}
```

**Fallback:** If no mentor available:
1. Speaker joins `#speaker-launchpad` general channel
2. Organizers get notified to manually assist
3. Speaker still gets all async resources

---

## 3. Speaker Journey

### Phase 1: Submission (Day 0)

```
┌─────────────────────────────────────────────────────────────┐
│  SUBMIT TALK                                                │
│  ├─ Fill form (existing)                                    │
│  ├─ Check "First-time speaker" ✓                            │
│  ├─ Check "Want mentorship" ✓                               │
│  └─ Select: "Full mentorship journey"                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  DISCORD CHANNEL CREATED                                    │
│  Channel: #launchpad-42-alice-smith                         │
│  Members: Speaker, Matched Mentor, @organizers              │
│                                                             │
│  🤖 Bot posts:                                              │
│  "Welcome to Speaker Launchpad! 🚀                          │
│   @alice-smith meet your mentor @bob-mentor                 │
│   Here's your journey timeline..."                          │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2: Proposal Refinement (Days 1-7)

**Automated Prompts (via Discord bot):**

| Day | Bot Action |
|-----|------------|
| 1 | "📝 Start by sharing your 2-sentence pitch with @mentor" |
| 3 | "🎯 Time to refine! What's the ONE thing attendees should remember?" |
| 5 | "📋 Review the [Proposal Template] and post your draft" |
| 7 | "✅ Mentor: Please react with ✅ when proposal is ready for review" |

### Phase 3: Content Development (Days 8-21)

**Resources Auto-Shared:**
- Link to slide templates
- "Rust NYC Talk Best Practices" guide
- Recording consent form
- A/V setup requirements

**Milestone Check-ins:**
| Day | Milestone |
|-----|-----------|
| 10 | Outline complete |
| 14 | First draft of slides |
| 18 | Technical accuracy review |
| 21 | Content freeze |

### Phase 4: Practice (Days 22-28)

**Dry Run Coordination:**

```typescript
// Bot command in channel
/schedule-dry-run @alice-smith @bob-mentor
// Opens scheduling widget, creates calendar event
// Records the session (with consent) for self-review
```

**Feedback Framework:**
- Mentor uses structured rubric (timing, clarity, code examples, pacing)
- Feedback delivered as Discord thread (searchable, async-friendly)

### Phase 5: Event Day

**Day-Of Checklist Bot:**
```
📋 Speaker Checklist - 2 hours before:
☐ Laptop charged
☐ Slides exported to PDF backup  
☐ Water bottle ready
☐ Arrived 15 min early for A/V check
```

### Phase 6: Post-Talk (Graduation)

- Mentor leaves final encouragement message
- Bot posts: "🎓 Congratulations! You're now a Rust NYC speaker!"
- Speaker invited to become future mentor
- Channel archived (read-only) for reference

---

## 4. Organizer Operations

### 4.1 New Discord Channels

| Channel | Purpose |
|---------|---------|
| `#speaker-launchpad` | Public channel for general speaker support questions |
| `#mentor-lounge` | Private channel for mentors to coordinate |
| `#launchpad-{id}-{name}` | Per-speaker private channels (auto-created) |

### 4.2 Organizer Dashboard Additions

**New API Endpoint:** `GET /api/launchpad/dashboard`

```typescript
interface LaunchpadDashboard {
  activeJourneys: number;
  awaitingMatch: number;
  mentorCapacity: { available: number; total: number };
  
  journeys: Array<{
    speakerId: number;
    speakerName: string;
    mentorName: string | null;
    phase: 'proposal' | 'content' | 'practice' | 'complete';
    daysInPhase: number;
    lastActivity: string;
    alerts: string[];  // e.g., "No activity in 5 days"
  }>;
}
```

### 4.3 Organizer Interventions

**Automated Alerts to `#organizers`:**
- "⚠️ No mentor available for new submission #47"
- "⚠️ #launchpad-42-alice inactive for 7 days"
- "⚠️ Mentor @bob at capacity (3/3 mentees)"

**Manual Override Commands:**
```
/launchpad assign #47 @specific-mentor    # Force match
/launchpad extend #42 proposal 7d         # Extend phase deadline
/launchpad graduate #42                   # Mark complete early
```

---

## 5. Database Schema Changes

```sql
-- New table: launchpad enrollments
CREATE TABLE speaker_launchpad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES talk_submissions_3(id),
  mentor_id INTEGER REFERENCES mentors(id),
  support_type TEXT NOT NULL,
  current_phase TEXT DEFAULT 'proposal',
  phase_started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  graduated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- New table: mentor pool
CREATE TABLE mentors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  max_mentees INTEGER DEFAULT 2,
  expertise_areas TEXT,  -- JSON array
  support_types TEXT,    -- JSON array
  timezone TEXT,
  active BOOLEAN DEFAULT true,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- New table: journey milestones
CREATE TABLE launchpad_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  launchpad_id INTEGER NOT NULL REFERENCES speaker_launchpad(id),
  milestone_type TEXT NOT NULL,
  completed_at DATETIME,
  notes TEXT
);
```

---

## 6. Success Metrics

### Primary Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Completion Rate** | % of Launchpad speakers who deliver talk | >80% |
| **Time to Stage** | Days from submission to talk delivery | <60 days |
| **Mentor Satisfaction** | Post-journey survey (1-5 scale) | >4.2 |
| **Speaker Satisfaction** | Post-journey survey (1-5 scale) | >4.5 |

### Secondary Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Return Rate** | % of Launchpad grads who submit again | >30% |
| **Mentor Conversion** | % of grads who become mentors | >15% |
| **Match Time** | Hours from submission to mentor assigned | <48h |
| **Phase Completion** | % completing each phase on time | >70% |

### Tracking Implementation

```typescript
// Event tracking for analytics
interface LaunchpadEvent {
  type: 'enrolled' | 'matched' | 'phase_advanced' | 'graduated' | 'dropped';
  launchpadId: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}
```

---

## 7. Mock Press Release Outline

---

### **FOR IMMEDIATE RELEASE**

# Rust NYC Launches "Speaker Launchpad" — Turning First-Time Speakers into Conference Stars

**New York, NY** — Rust NYC today announced Speaker Launchpad, a mentorship program that pairs first-time speakers with experienced community members to guide them from initial idea to standing ovation.

### The Problem
> "I have a great talk idea, but I've never spoken at a meetup. Where do I even start?"

80% of potential speakers never submit because they feel unprepared. The tech community loses diverse voices and fresh perspectives.

### The Solution
Speaker Launchpad provides:
- **1:1 Mentorship** — Matched with an experienced speaker who's been there
- **Structured Journey** — Clear milestones from proposal to practice run
- **Community Support** — Never feel alone in your preparation

### By the Numbers
- **4 weeks** average time from idea to stage-ready
- **90%** of Launchpad speakers deliver their talk (vs. 60% general)
- **50%** of graduates go on to speak at other events

### Quote from Organizer
> "We don't just want talks — we want to grow speakers. Speaker Launchpad invests in people, and that investment comes back tenfold to our community."  
> — *[Organizer Name], Rust NYC*

### Quote from Graduate
> "I never thought I could give a tech talk. My mentor helped me realize my debugging war story was actually interesting. Now I can't wait to do it again."  
> — *[Speaker Name], Launchpad Graduate*

### How It Works
1. Submit your talk idea at [rustnyc.dev/submit]
2. Check "I'm a first-time speaker" and "I'd like a mentor"
3. Get matched within 48 hours
4. Follow the guided 4-week journey
5. Deliver your talk to a supportive audience

### Call to Action
**Aspiring Speakers:** Submit your idea today. We'll help you get there.  
**Experienced Speakers:** Join our mentor pool and pay it forward.

**Links:**
- Submit a talk: rustnyc.dev/submit
- Become a mentor: rustnyc.dev/mentor
- Learn more: rustnyc.dev/launchpad

---

*Rust NYC is a monthly meetup bringing together Rust developers in the New York City area.*

---

## 8. Implementation Phases

### Phase 1: MVP (2 weeks)
- [ ] Add form fields to `TalkSubmissionForm.tsx`
- [ ] Create `speaker_launchpad` and `mentors` tables
- [ ] Basic matching logic (manual mentor assignment)
- [ ] Modified Discord channel creation with mentor ping

### Phase 2: Automation (2 weeks)
- [ ] Automated matching algorithm
- [ ] Phase advancement bot messages
- [ ] Organizer dashboard API

### Phase 3: Polish (2 weeks)
- [ ] Mentor self-service (availability, expertise)
- [ ] Analytics tracking
- [ ] Graduate-to-mentor flow

---

## Remaining Work

For orchestrator follow-up:

1. **Design Review:** Get feedback on form UX changes from frontend task
2. **Discord Bot Scope:** Determine if existing bot framework supports scheduled messages or if new bot needed
3. **Mentor Recruitment:** Draft outreach message for existing speakers to join mentor pool
4. **Legal Review:** Ensure mentor/mentee interactions have appropriate code of conduct coverage
5. **Integration:** Coordinate with other features (e.g., if "Talk Tracks" feature exists, mentors should match by track)

---

*Document generated: 2026-02-06*  
*Author: Background Task `deep-mentorship`*

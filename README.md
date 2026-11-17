# Pathwise — Study Progress Tracker with Prerequisite Rules

A web app where learners track study goals and the topics under them. **A topic stays locked until all of its
prerequisites are complete**, and every goal shows its progress. Built with Node + Express, **MongoDB** (Mongoose)
and a dependency-free animated frontend, with a public home page.

## What's in v2

| Area | Feature | Where to look |
| --- | --- | --- |
| Quick wins | Estimated hours per topic + a **deadline forecast** (on track / at risk / behind / stalled / overdue) from your last 4 weeks of pace | `goalForecast` in `shared/features.js`; goal page and dashboard warnings |
| | **Notes and resource links** on each topic (http/https only) | topic drawer; `PUT /api/topics/:id/notes` |
| | **CSV / PDF export** (formula-injection-safe CSV; PDF via pdfkit) | `server/routes/export.js`, `server/services/pdf.js` |
| | **People screen** to create/edit/deactivate learners and mentors, reset passwords | `server/routes/admin.js`, `client/js/views/people.js` |
| AI | **Roadmap generator** ("Learn Rust" → topics + prerequisites, loop-checked, editable before saving) | `server/routes/ai.js`, `client/js/views/roadmap.js` |
| | **Quiz per topic** and a **study coach** that answers from your real progress | `/api/topics/:id/quiz`, `/api/coach` |
| | **Smarter plans**: a 7-day schedule on the weekdays/times you actually study | `suggestSchedule`; Weekly plan page |
| Collaboration | Mentor **assigns goals** (to learners or whole cohorts) and **approves completion** | `/api/admin/assign`, approvals inbox |
| | **Cohorts** with progress / at-risk stats | People → Cohorts |
| | **Read-only share link** per goal (expiring, revocable; no email, notes or links exposed) | `server/routes/share.js` |

### Approvals: how the rules interact
On a goal that requires approval, "Mark complete" becomes **Submit for approval**. The topic shows as *Awaiting approval*
and its dependants **stay locked** until a mentor approves it. A mentor can send it back with feedback. Reopening a
prerequisite withdraws submissions that depended on it. Mentors structure assigned goals; learners study them and
keep their own notes.

### AI features and honesty
Roadmaps, quizzes and the coach use **Google Gemini when `GEMINI_API_KEY` is set** (free key from Google AI Studio), and every response says which source
produced it. Without a key (or if a call fails or returns invalid output) built-in logic answers instead: curated
roadmap templates, recall prompts instead of graded quizzes, and a rule-based coach. AI output is always validated
(`sanitizeRoadmap`, `sanitizeQuiz`) before use, and numbers always come from code, never from the model.
The Gemini-powered paths could not be exercised live in development (no key); the validation and fallbacks are tested.

## Run it

Requirements: Node 18+ and a running MongoDB (local, Docker or Atlas).

```bash
npm install
cp .env.example .env          # set MONGODB_URI and JWT_SECRET
npm run seed                  # demo data (npm run seed:reset wipes and rebuilds)
npm start                     # http://localhost:4000
```

No MongoDB handy? `docker run -d -p 27017:27017 mongo:7`

**Demo accounts** (created by the seed)

| Role    | Email              | Password   |
| ------- | ------------------ | ---------- |
| Learner | learner@demo.com   | learner123 |
| Learner | diya@demo.com      | learner123 |
| Mentor  | mentor@demo.com    | mentor123  |

Mentors create people (learners or other mentors) from the **People** screen in the app; the command
`npm run create-user -- "Name" email@x.com Password123 mentor` still works for the very first account.
Self-registration always creates a **learner**.

**Frontend-only preview** (no server or database): `npm run preview`, then open `preview/pathwise-preview.html`.
It runs the same rules code against sample data held in memory.

## How it maps to the brief

| Brief requirement | Where |
| --- | --- |
| Two roles enforced on the server; mentor views any learner, learner edits only their own; mentor is admin | `server/middleware/auth.js` (role is re-read from the database on every request), checks in every route |
| Goals → topics → prerequisites; reject self-reference and loops | `shared/rules.js` `validatePrerequisites`, `findCyclePath` |
| Session log: date, topic, minutes, note; minutes within configured min/max (default 5–480); no future dates | `shared/rules.js` `validateSession`, `server/routes/sessions.js`, `client/js/views/forms.js` |
| Unlock rule in code; show missing prerequisites | `computeStates`, `planComplete` (API returns `409 LOCKED` with the missing topics) |
| Reopened topic re-locks its dependents | `planReopen` (policy `cascade` or `block`, configurable) |
| Progress per goal: percent complete, total minutes, a chart | Goal page: progress ring, minutes, weekly chart, time per topic |
| Admin-configurable values in core logic | Settings page / `PUT /api/config`: min and max session minutes, max prerequisites per topic, weekly target, reopen policy. Read from the database on each request, so a change applies immediately with no code change |
| Seed: 3 goals, 12 topics with prerequisites, 30 sessions over six weeks | `shared/seed-data.js`, `server/seed/seed.js` |
| Extras (incl. AI) | See "What's in v2" above, plus weekly review, streaks and consistency heatmap, mentor feedback, focus timer, light/dark theme |

## The rules, in one place

All business rules live in `shared/rules.js`: pure functions with no database or DOM access. The server, the tests and the
preview all use the same file.

* **Unlock** — a topic is *locked* while any prerequisite is incomplete. State is derived from current completion flags
  every time, so it can never go stale.
* **Re-lock** — reopening a topic locks everything that depends on it. With `cascade` (default) completed dependents are
  reopened too, keeping the invariant "complete ⇒ prerequisites complete". With `block`, the reopen is refused while
  dependents are complete.
* **No loops** — a topic can't require itself, directly or through a chain; the message shows the loop
  (`A → C → B → A`). The UI also greys out choices that would create one.
* **Approval** — with approval required, completing only *submits*; dependants unlock when a mentor approves.
* **Sessions** — minutes must be whole numbers within the configured range; dates can't be in the future (judged in
  `APP_TZ`); no sessions on locked topics.

## Weekly review and study plan

`GET /api/insights` computes the facts deterministically (minutes vs. previous week, streak, stalled topics, what just
unlocked) and builds a plan that only ever suggests **unlocked** topics, prioritising work already in progress and topics
that unlock the most others.

* Without an API key the written summary comes from a built-in template (labelled "Auto summary").
* With `GEMINI_API_KEY` set, Gemini writes the summary from those facts (labelled "Written by Gemini"); if the call fails
  the app falls back to the template. The numbers always come from code, never from the model.

## Tests

```bash
npm test            # unit tests (rules + features) and API tests
npm run test:rules  # unit tests only, no database needed
```

API tests need MongoDB. They use `mongodb-memory-server`, or set `MONGODB_TEST_URI` to use a database you already have
(**it is wiped**). They cover: roles on the server, people/cohort admin, assigned goals and the approval flow, share links
(no private data, revoke, expiry), CSV/PDF export, AI fallbacks, the smart schedule, roadmap import, the unlock rule, re-locking on reopen (both policies), loop and self
rejection, and configuration changes altering behaviour with no code change.

## Structure

```
shared/      rules.js, features.js (forecast, schedule, roadmap, quiz, coach, CSV), seed-data.js — used by server, tests, preview
server/      app.js, routes/, models/, middleware/, seed/, services/
client/      index.html, css/styles.css, js/ (ui, charts, views)
tests/       rules.test.js, features.test.js, api.test.js
tools/       build-preview.js, mock-api.js                    — offline preview
```

## Design notes

Palette: deep-ink night with aurora accents — violet (brand), cyan (ready), mint (complete), amber (in progress), rose
(errors), slate (locked). State is encoded in colour *and* icon + label. Animations respect `prefers-reduced-motion`.

## Security notes

JWT in an `httpOnly` cookie, bcrypt password hashes, Helmet with a strict CSP, rate-limited login, request size limit.
Set `JWT_SECRET` (required in production) and `COOKIE_SECURE=true` behind HTTPS.

Share links: the token is random (24 bytes), the public endpoint is rate-limited, read-only and returns a restricted
snapshot. AI endpoints are rate-limited per user. Spreadsheet formulas in exported CSV are neutralised.

## Known limitations
* The offline preview can't download files: CSV opens in a dialog and PDF export needs the full app.
* API tests were run against FerretDB (MongoDB-compatible) rather than a real MongoDB server; they use only standard queries.
* Share links are bearer tokens: anyone with the link can view that goal until it expires or is revoked.

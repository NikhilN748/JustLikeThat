# Hours Tracker V2 Roadmap

## Goal

V2 should turn Hours Tracker from a solid personal time tracker into a reliable, polished, and extensible timesheet app.

The focus for V2 is not to add random features. The focus is to make the app stronger in five areas:

1. data accuracy
2. reporting
3. project and client tracking
4. reliability
5. future readiness for sync or team use

---

## Current strengths

The app already supports:

- local-first usage with no account required
- manual entry and clock in or clock out flow
- break tracking
- overtime calculations
- weekly and calendar views
- JSON backup and restore
- IndexedDB backup support
- service worker reminders and missed clock-out alerts
- test coverage for overnight sessions, DST handling, and legacy entry normalization

V2 should build on these strengths instead of replacing them.

---

## V2 priorities

### Priority 1
Make time data more durable and easier to trust.

### Priority 2
Make reports more useful for real work and payroll use.

### Priority 3
Make sessions easier to organize by client, project, and tag.

### Priority 4
Improve maintainability so the codebase is easier to grow.

### Priority 5
Prepare the app for optional future sync and team workflows.

---

## Phase 1: Core data and time accuracy

### Objective
Lock down the data model so all future features sit on a stable base.

### Work
- make every session fully timestamp-aware
- keep both display time and exact ISO timestamps
- improve schema migration handling
- store session metadata consistently:
  - `id`
  - `clientId`
  - `projectId`
  - `tagIds`
  - `timezone`
  - `createdAt`
  - `updatedAt`
  - `source`
- store entry-level metadata consistently:
  - `status`
  - `lockedAt`
  - `dayType`
- improve handling for:
  - overnight shifts
  - DST changes
  - missing clock-outs
  - edits to older entries
- prevent silent data corruption during restore or migration
- validate imported backup files before applying them

### Exit criteria
- old data can migrate safely into the new format
- tricky time cases behave correctly
- restore does not break the app
- session records are consistent across manual edits and live clock use

---

## Phase 2: Clients, projects, and tags

### Objective
Let users organize time in a way that is actually useful for invoicing, reporting, and filtering.

### Work
- add master lists for clients
- add master lists for projects
- add session tags such as:
  - Meeting
  - Support
  - Development
  - Admin
  - Travel
- allow assigning client, project, and tags per session
- support project-to-client linking
- add filters on:
  - tracker page
  - calendar page
  - export screens
- show grouped totals by:
  - client
  - project
  - tag

### Exit criteria
- every session can be categorized cleanly
- weekly totals can be filtered
- reports can be grouped by project or client
- tagging feels fast and not heavy

---

## Phase 3: Reporting and payroll

### Objective
Make the app more useful for payroll, invoicing, and real-world review.

### Work
- improve weekly report layout
- add monthly summary view
- add custom date range report improvements
- add payroll-ready totals:
  - regular hours
  - overtime hours
  - break totals
  - total pay
- add client-ready export formats
- add project summary export
- improve PDF layout for readability
- add CSV export for grouped totals
- add optional invoice summary mode
- add entry status flow:
  - open
  - submitted
  - approved
  - locked

### Exit criteria
- a user can export a clean report without manual cleanup
- payroll totals match tracked data
- client and project summaries are easy to read
- locked entries cannot be changed accidentally

---

## Phase 4: Reliability and recovery

### Objective
Make the app safer for long-term use.

### Work
- improve autosave behavior
- show clearer restore warnings and confirmations
- add backup health checks
- add visible last-saved status
- improve recovery flow after tab close or crash
- add optional backup reminder settings
- improve service worker reliability for reminders
- add fallback behavior when notification permissions are blocked
- make backup export names clearer and timestamped

### Exit criteria
- users can recover confidently after mistakes
- backups are easier to understand
- reminders fail gracefully instead of silently confusing the user
- save behavior feels dependable

---

## Phase 5: UI and codebase cleanup

### Objective
Make the project easier to maintain and easier to improve.

### Work
- split large UI styles into `styles.css`
- split app logic into focused modules such as:
  - storage
  - session logic
  - reporting
  - notifications
  - calendar
  - export
- reduce direct DOM coupling where possible
- add reusable utility functions
- clean up naming and file structure
- improve accessibility:
  - keyboard behavior
  - labels
  - focus states
  - contrast
- improve mobile responsiveness
- keep the app fast and lightweight

### Exit criteria
- code is easier to navigate
- new features can be added without touching everything
- the app feels more polished on mobile and desktop
- basic accessibility issues are reduced

---

## Phase 6: Test coverage and quality

### Objective
Expand confidence before adding larger features.

### Work
- grow test coverage beyond core time math
- add tests for:
  - migration cases
  - restore logic
  - payroll calculations
  - project and tag filtering
  - export formatting
  - notification timing logic
- add a basic release checklist
- add smoke testing for major user flows

### Exit criteria
- critical flows are covered by tests
- regressions are easier to catch
- releases are less risky

---

## Phase 7: Optional V2.5 and future direction

### Objective
Prepare for larger product growth without forcing it into V2 right away.

### Possible next steps
- cloud sync
- sign-in
- multi-device sync
- employee and admin roles
- team timesheet approval
- audit history
- shared project workspaces
- manager review dashboard

### Note
These should stay out of core V2 unless the single-user experience is already stable.

---

## Recommended build order

### Version 2.1
Core data and time accuracy

### Version 2.2
Clients, projects, and tags

### Version 2.3
Reporting and payroll improvements

### Version 2.4
Reliability and recovery

### Version 2.5
UI cleanup, modular code, and expanded tests

---

## What not to do in V2

To keep the project focused, avoid these too early:

- full authentication
- backend setup
- team roles
- complex cloud sync
- too many export formats at once
- redesigning everything before stabilizing data

---

## Best next move

If you want the highest-value next step, do this first:

1. finish the timestamp-safe data model
2. finalize migration support
3. add project, client, and tag assignment to sessions
4. improve grouped reporting
5. expand tests around those new flows

That path gives the biggest improvement without making the app too heavy.

---

## Success definition for V2

V2 is successful if the app becomes:

- more trustworthy with time data
- easier to organize
- more useful for payroll and reporting
- safer to maintain
- ready for future expansion
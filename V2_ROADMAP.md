# Hours Tracker V2 Roadmap

## Vision
Version 2 should evolve this app from a simple personal hours tracker into a durable timesheet platform with richer reporting, better data integrity, and room for multi-project or multi-user workflows.

## Phase 1: Data Foundation
- Make all sessions fully timestamp-aware.
- Introduce schema migrations so future releases do not break existing data.
- Enrich session records with `id`, `clientId`, `projectId`, `tagIds`, `timezone`, `createdAt`, `updatedAt`, and `source`.
- Enrich day entries with `status` and `lockedAt` for future approval and locking flows.
- Add automated tests for migration, overnight shifts, DST, and manual edits.

Status: In progress

## Phase 2: Projects, Clients, and Tags
- Add project and client master lists.
- Let each session be assigned to a project/client.
- Add session tags like `Meeting`, `Support`, `Development`, and `Travel`.
- Add filters and grouped totals by project/client/tag.

## Phase 3: Reporting and Payroll
- Add weekly, monthly, and custom date-range reports.
- Add overtime calculations and configurable rate rules.
- Add printable timesheets and export to CSV/PDF/Excel.
- Add invoice-ready client reports.

## Phase 4: Reliability and UX
- Split CSS into `styles.css` and keep `app.js` modular.
- Add IndexedDB storage for larger datasets.
- Add undo, autosave, and stronger recovery flows.
- Improve mobile UI, installability, and accessibility.

## Phase 5: Team Features
- Add sign-in and cloud sync.
- Add employee/admin roles.
- Add timesheet submission, approval, and locking.
- Add audit history for changes.

## Recommended Next Build
After Phase 1, the highest-value next step is Phase 2:
1. Add a lightweight data store for clients/projects/tags.
2. Add selectors in the session editor.
3. Add grouped reporting in the weekly and export views.

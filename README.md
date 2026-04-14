# Hours Tracker

A simple, private hours tracker built with plain HTML, CSS, and JavaScript.

No accounts. No subscriptions. No backend. Your data stays on your device.

## What it does

Hours Tracker helps you:

- clock in and out
- track breaks
- calculate worked hours
- calculate pay based on your hourly rate
- view weekly and calendar-based summaries
- export and restore your data
- get reminder notifications for schedule and missed clock-outs

## Features

### Time tracking
- Manual time entry for each day
- Clock in and clock out flow
- Break tracking
- Support for overnight sessions
- Exact time tracking with no forced rounding

### Weekly and calendar views
- Weekly totals for hours and earnings
- Overtime progress and pay calculation
- Calendar view with worked-day summaries
- Custom date range reporting

### Backup and recovery
- localStorage for fast local saves
- IndexedDB as a backup layer
- JSON export and restore

### Notifications
- Shift start reminders
- Shift end reminders
- Missed clock-out alerts

### Project structure
- `index.html` contains the app shell and styles
- `app.js` contains the app logic
- `sw.js` handles service worker notifications
- `test/time-logic.test.js` contains time logic tests
- `.github/workflows/static.yml` deploys the app to GitHub Pages

## How it works

This app runs entirely in the browser.

There is no server and no database outside your device. All data is stored locally in your browser unless you choose to export it.

## Run locally

You can open the app directly in a browser:

1. Download or clone the repository
2. Open `index.html`

For best results, use a modern browser.

## Deploy with GitHub Pages

This repo includes a GitHub Actions workflow for GitHub Pages deployment.

When you push to the `main` branch, the workflow in `.github/workflows/static.yml` can publish the app.

## Run tests

The project includes a test file for time logic.

It covers cases like:

- same-day sessions
- overnight sessions
- DST changes
- session splitting across calendar days
- legacy entry normalization

Run tests with Node.js:

```bash
node test/time-logic.test.js
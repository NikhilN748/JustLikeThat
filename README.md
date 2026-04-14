# Hours Tracker

Built for people who want a simple, private time tracker with no accounts, no subscriptions, and no data leaving their device. It's one HTML file. Open it in a browser and it works.

Everything lives in your browser's localStorage and IndexedDB. No sign-up, no server, no analytics.

## What it does

### Tracker
Log when you clocked in and out each day. The app calculates hours worked and pay based on your hourly rate. The weekly earnings banner shows your total for the week, with a live overtime progress bar that fills up as you approach your overtime threshold. It turns amber when you're getting close and red once you've crossed into overtime territory.

Tap any day to add or edit that day's entry. Swipe left or right to move between weeks, or tap the date range in the week card to jump directly to any week using the date picker.

### Clock In / Out
Drag the slider to clock in or out. The slider is green when you're clocking in and red when you're clocking out. As you drag, the track fills to show how far you've pulled it.

Once clocked in, a break button appears below the slider. Tap "Start Break" when you step away and "End Break" when you return. The break time is automatically logged to your session with no manual input required.

After every clock in or clock out, a toast notification appears at the bottom of the screen with an Undo button. You have 5 seconds to reverse the action if you made a mistake.

### Calendar
The month view shows a circle for each day with a small hours label if you worked that day. Tap the month name to jump to any month or year without clicking the arrow repeatedly.

Tap the calendar icon in the top right to open the custom date range mode. Pick any start and end date to see total hours, total earnings, days worked, and daily average for that range. Quick preset chips (Last 7 days, Last 30 days, This month, Last month, Last 3 months, This year) let you jump to common ranges in one tap.

### Settings
- **Work Identity:** Set your hourly rate, currency, week start day, overtime threshold (how many hours per week before overtime kicks in), and overtime rate multiplier.
- **Schedule:** Enable specific days and set start and end times. The app uses these to send you notifications.
- **Preferences:** Toggle dark theme and the weekly overtime indicator bar.
- **Data Management:** Export CSV for the current week, current month, or a custom date range. Export a formatted PDF timesheet that breaks out regular and overtime pay. Create a JSON backup or restore from a previous one.

## Notifications

The app can send you two types of notifications based on your schedule settings:

- A reminder 10 minutes before your scheduled clock-in time if you have not clocked in yet.
- An alert 10 minutes after your scheduled clock-out time if you are still clocked in.

Grant notification permission when prompted on first load for these to work.

## Overtime

Hours worked beyond your weekly threshold are paid at your overtime rate. The defaults are 40 hours and 1.5x, but both can be changed in Settings under Work Identity. The overtime bar on the Tracker page shows your progress through the week in real time.

Example at $10/hr with a 40-hour threshold and 1.5x rate, working 45 hours:
- Regular: 40 hours x $10 = $400
- Overtime: 5 hours x $10 x 1.5 = $75
- Total: $475

The PDF timesheet shows this breakdown explicitly.

## Backup and data safety

Your data is stored in three places automatically:
1. **localStorage** is the primary store and loads instantly on every open.
2. **IndexedDB** receives a copy on every save as a second safety layer.
3. A **daily localStorage snapshot** is saved silently in the background once per day.

If you want the same data on multiple devices, export a JSON backup from Settings, save it somewhere (Google Drive, iCloud, email), and restore it on the other device. The app will prompt you once per day if you have not backed up yet. Dismissing the prompt will stop it from appearing again until the next day.

CSV export is on the Tracker tab for pasting a week's hours into an invoice or spreadsheet.

## Using it as a web app

Open `index.html` in a browser. On iPhone or Android, tap Share and choose "Add to Home Screen" to install it as a full-screen app with its own icon.

The File System autosave only works when running from a local file path on a desktop browser. When used as a web app on mobile, the automatic daily snapshot to localStorage is your safety net.

## What is inside

One HTML file and one JS file, both vanilla with no frameworks, no build step, and no dependencies. CSS variables handle theming so dark mode follows your system setting. Data has a schema version number so format changes can be migrated without losing anything.

View Source is the whole app.

## Privacy

Open DevTools, go to the Network tab, and use the app. The tab stays empty. That is the privacy policy.

## License

It is yours. Fork it, change it, use it, whatever. If something is broken, open an issue.

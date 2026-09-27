# Habit Tracker


Habit Tracker keeps your habits and history in a file you control. There is no account to create and no cloud service required. Use the desktop app on Windows, optionally keep the same habits on Android, and let a file-sync service such as Syncthing carry the shared file between them.

## What you can do

- Create habits for anything you want to repeat: exercise, medication, reading, chores, and more.
- Decide how often each habit is due, from every day to selected weekly, monthly, or yearly schedules.
- Set more than one check-in per day and place each one in the part of the day where it belongs.
- Check off today’s habits, undo an accidental check-in, and see what is resting today.
- Organize habits into custom groups with names and colors.
- Review 30- or 90-day progress, consistency, check-ins, perfect days, and streaks.
- Archive habits without losing their history, or permanently delete ones you no longer need.
- Use the same data on Windows and Android through an optional synced folder.

## Getting started

### Windows desktop app

1. Open Habit Tracker. On first launch, it creates a data file named `habit.json` in its default data folder.
2. Open **Habits** and choose **Add habit**.
3. Give the habit a clear name, choose an icon and color if you like, and select a group.
4. Choose how often it should happen and how many times it is due each day.
5. Save it. Your habit will appear on **Today** whenever it is due.

Your usual next step is simply to open **Today** and check in as you complete each occurrence.

### Android app

The Android app can use the same `habit.json` file as the desktop app.

1. Set up your chosen sync service so the desktop app’s data folder is available on your phone. Syncthing is a good option, but it is not required if you only use one device.
2. Open Habit Tracker on Android and choose **Choose Syncthing folder**.
3. Select the folder that contains `habit.json`—not its parent folder.
4. When the file has arrived, the app opens your habits automatically. If you are starting on the phone, choose **Create default habit.json** instead.

Keep the sync service up to date before switching devices. If both devices change the same habit while offline, resolve the conflict copy shown in **Settings** before continuing.

## Daily use

### Check in on Today

**Today** is the main screen. It groups due check-ins into **Morning**, **Afternoon**, **Evening**, **Night**, and **Anytime**.

- Tap or click a check circle to record that occurrence; tap it again to undo it.
- A habit scheduled multiple times a day has a separate check-in for each chosen time.
- An **Anytime** habit shows its progress, such as `1/3`; keep checking it in until all occurrences are complete.
- The **Resting today** section lists habits that are not scheduled today. You can still add an extra check-in if you completed one.
- The progress display and small seven-day history help you see how the day and your recent routine are going.

### Create a useful schedule

In the habit editor, pick the schedule that matches real life:

- **Every day**, **weekdays**, and **weekends** are useful for regular routines.
- Weekly schedules suit habits such as gym sessions or calling family.
- Monthly and yearly schedules work for less frequent reminders.
- For a habit that happens more than once daily, increase **times per day** and give every occurrence a preferred time. For example, set “Brush teeth” to twice daily with **Morning** and **Evening**.
- Use **Anytime** when the time does not matter. The app will track the number of completed occurrences instead of assigning a time slot.

You can change a habit’s schedule later. Your recorded history remains in place; the app calculates progress and streaks from the habit’s current rules and check-in history.

## Manage habits and groups

Open **Habits** to keep your list tidy.

- Select **Add habit** to create another routine.
- Open an existing habit to change its name, icon, color, group, schedule, or daily timing.
- Reorder habits to put the most important ones first.
- Use **Archive** for a habit you may want to revisit. Archived habits stop appearing in daily tracking but retain their history and can be restored.
- Use **Delete** only when you want to remove a habit and its record permanently.
- Manage groups from the group controls to add, rename, recolor, archive, or remove them.

## Understand your progress

Open **Reviews** for a longer view of your routine.

- Switch between **30-day** and **90-day** ranges.
- See total check-ins, active days, perfect days, and your best live streak.
- Review each habit’s dot grid, current streak, best streak, total check-ins, and consistency percentage.
- Darker dots represent more check-ins on that day. A habit due multiple times on one day needs all of its expected occurrences for a perfect day.

Streaks reflect each habit’s schedule. A weekend-only habit, for example, does not lose a streak because it was not due on a weekday.

## Settings, data, and privacy

Habit Tracker is **local-first**: your data is stored in one `habit.json` file rather than in an account on a remote server.

In **Settings**, you can:

- View or change the data folder on desktop, or choose a different sync folder on Android.
- Create a backup immediately with **Backup now**.
- Turn automatic refresh from the sync folder on or off.
- Choose a light, dark, or system theme.
- Set the first day of the week used in weekly views and streak calculations.

The apps create rolling backups before risky changes and keep recent copies. On desktop, backups are kept in a `.backups` folder beside `habit.json`. If the app detects a damaged data file, it offers recovery choices instead of silently overwriting it.

### Syncing safely

Syncthing is an optional way to keep the file in sync between Windows and Android. It is a separate app/service; install and configure it independently, then point Habit Tracker at the synced folder.

For the safest experience:

1. Let syncing finish before opening the other device.
2. Avoid making changes on both devices while they are disconnected.
3. If a sync conflict is reported in **Settings**, keep the version you need and make a backup before replacing files.

## Installation and development

Most people should use a packaged Windows release or Android build provided by the project owner. This repository also includes the source code for people who want to run or build it themselves.

To run the desktop app from source, install Node.js 18 or later, then run:

```bash
npm install
npm run dev
```

To create Windows distributables from source:

```bash
npm run dist:win
```

The project is organized as a shared rules package plus desktop and Android apps. Both apps use the same data format so schedules, check-ins, and progress stay consistent across devices. More implementation details are available in [`docs/SYNC-DESIGN.md`](docs/SYNC-DESIGN.md) and [`packages/core/SCHEMA.md`](packages/core/SCHEMA.md).

## Help

- **The Android app says it cannot find `habit.json`:** choose the exact synced folder containing the file, then confirm your sync service has finished.
- **A habit is missing from Today:** check whether it is archived or simply not scheduled for the current day.
- **A check-in was a mistake:** tap or click its completed check circle again to undo it.
- **You want to start over:** back up your current file first, then create or select a new data folder.

## License

[MIT](LICENSE)

## Repository

https://github.com/GetYourWish/Habit-Tracker

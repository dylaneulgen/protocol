# Protocol

A fully local habit tracker built around nested goals — not a planner. You
organize goals in a collapsible outline ("Learn Japanese" → anki, immersion),
and every goal recurs: each one is something you do every day (you can exclude
a day or two), optionally at a time, optionally with a length. Leaves get a
checkbox each day they're due; parents roll up today's progress; streaks keep
you honest. A tiny box in the title bar shows today's count and pops up the
day's checklist. There's also a plain notes area and a stopwatch.

I built this for myself.

## Install

- **[Download for Windows](https://github.com/dylaneulgen/protocol-app/releases/latest)** — `Protocol Setup <version>.exe`
- **[Download for macOS](https://github.com/dylaneulgen/protocol-app/releases/latest)** — `Protocol-<version>-mac.dmg` (universal — Apple Silicon + Intel)

Your data is local.

> **Upgrading from 1.x (the planner):** your goal tree carries over; every item
> becomes recurring. The calendar and one-off scheduled tasks are gone — that's
> the point.

## Run from source

```bash
npm install
npm start
```

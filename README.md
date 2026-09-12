# Court Rotation Generator

A mobile-first court-side planner for fair doubles rotations in pickleball or badminton.

## What it includes

- Session setup: players, games/player, courts, target session length, game duration, rest preference, and randomization mode
- Fairness-scored rotation generation with no repeated partners when the requested schedule permits it
- Balanced playing time, sit-outs, opponents, and four-player groups
- Live **Current Game** hero with court number, matchup, sitting-out players, progress, and one-tap completion
- Bottom mobile navigation for Setup, Live, Schedule, Players, and More
- Compact schedule timeline with completed/locked/upcoming states
- Player availability controls and safe **Rebuild remaining** behavior
- Locked games and completed games are preserved during rebuilding
- Player cards with games, sit-outs, partners, opponents, and balance status
- Court Mode for large, high-readability court-side display
- High-contrast and large-text preferences
- Light/dark mode
- Copy current game, copy full schedule, native share, printable schedule, and CSV export
- Player list save/load through browser local storage
- Session code plus QR/share snapshot links
- Defensive validation and regeneration attempts for difficult combinations
- Fully static: no account, backend, or database required

## Files

- `index.html` — page structure and navigation
- `styles.css` — responsive/mobile UI and display modes
- `scheduler.js` — fair rotation generation and scoring
- `app.js` — live session state, controls, sharing, export, and UI logic

## Run locally

Open `index.html` in a modern browser. No build step is required.

## Deployment

The project can be deployed directly as a static site to GitHub Pages, Netlify, Vercel, or another static host.

## Scheduling notes

The generator scores candidate schedules for partner uniqueness, rest balance, opponent repetition, repeated four-player groups, and randomized variety. Exact schedules can be mathematically constrained by the number of players and requested games/player, so the app validates impossible combinations and explains when a rebuild cannot preserve all locked/completed games.

For multiple courts, games are assigned rotating court numbers while retaining a simple game-by-game order for live tracking.

QR/share links contain a **snapshot** of the current game. They do not provide live multi-device synchronization.

## Stability

The app is intentionally kept as a dependency-free static site. Popup behavior is handled by the main app and the dedicated name normalizer; no extra session click-interceptor script is required.

## Recent fixes

- Fixed Schedule shuffle/rebalance so it correctly regenerates the schedule and keeps the user on the Schedule view.
- Standardized Schedule **Result** and **Lock** action styling with the main UI buttons.
- Added consistent spacing above the Schedule Result/Lock actions.

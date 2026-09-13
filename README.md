# Court Rotation Generator

A mobile-first court-side planner for fair doubles rotations in pickleball or badminton.

## What it includes

- Session setup for players, courts, game timing, and target session length
- Fair rotation generation with balanced partners, opponents, play counts, and sit-outs
- Locked/completed games preserved during rebuilding
- Live current-game tracking and progress
- Schedule timeline with shuffle/rebalance
- Player availability and stats
- Rankings and game results
- Court Mode, large text, high contrast, and light/dark mode
- Copy/share tools, printable schedule, and CSV export
- Browser local storage for session/player data
- Fully static: no account, backend, database, or paid feature layer required

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

The generator scores candidate schedules for partner uniqueness, rest balance, opponent repetition, repeated four-player groups, and randomized variety. Exact schedules can be mathematically constrained by the number of players and requested games/player, so the app validates difficult combinations and explains when a rebuild cannot preserve all locked/completed games.

For multiple courts, games are assigned rotating court numbers while retaining a simple game-by-game order for live tracking.

QR/share links contain a snapshot of the current game. They do not provide live multi-device synchronization.

## Stability

The app uses a small dependency-free runtime: `index.html`, `styles.css`, `scheduler.js`, and `app.js`. Legacy pricing, Pro, facility, popup, shuffle, and performance patch layers have been removed. Performance limits now live directly inside the core scheduler so there is one generation path instead of stacked overrides.

# Court Rotation Generator

A mobile-first browser app for generating fair doubles rotations for pickleball or badminton.

## Features

- Session setup for player count, player names, games per player, courts, target session length, game duration, rest preference, and randomization mode
- Fairness-scored randomized schedules
- No repeated partners whenever mathematically possible
- Balanced games and sit-outs
- Reduced repeated four-player groups and repeated opponent matchups
- Large visual game cards for court-side phone use
- Live session mode with **Mark game complete** and **Next game**
- Player availability controls and rebuild support
- Lock individual matchups; completed and locked games are preserved when rebuilding
- Player statistics for games, sits, partners, opponents, and balance status
- Fairness score and session summary
- Shuffle / better balance
- Copy schedule, CSV export, and print
- Save/load player lists locally
- Light/dark mode
- Responsive mobile-first layout with large controls and readable typography
- Defensive validation and fallback generation attempts for difficult schedules
- No backend, account, or database required

## Run locally

Open `index.html` in a modern browser. No build step is required.

## Deployment

This is a static site and can be deployed directly to GitHub Pages, Netlify, Vercel, or any static hosting provider.

## Scheduling notes

The generator scores candidates for partner uniqueness, balanced games, balanced sit-outs, opponent repetition, repeated four-player groups, and consecutive rests. Some combinations are mathematically constrained, so the UI reports when the selected settings cannot produce an exact schedule.

For multiple courts, games receive rotating court assignments. The schedule remains in a clear game-by-game order for live session tracking.

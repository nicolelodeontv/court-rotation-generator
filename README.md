# Court Rotation Generator

Fast, local-first doubles rotation planner for pickleball and badminton.

## Core
- Balanced partner and rest rotation generation
- Odd-player sit-out handling
- Player skill levels: Beginner / Intermediate / Advanced
- Local SAVE / RESUME and offline-ready service worker
- Player substitution and remaining-schedule rebuild
- Dark mode, large text, high contrast, mobile-friendly controls
- CSV export and print-friendly schedule

## Gamification
- ELO-style player ratings starting at 1200
- Rating changes after recorded results
- Achievements: Unstoppable, Perfect Week, Best Partners, Iron Player
- Local seasonal leaderboards with named seasons
- Partner play-count history

## Display
- Court Display read-only snapshot generated from the manager
- Large current/queued games and leaderboard for a shared screen

The current architecture stays browser-first and does not require a backend for normal sessions. A future backend can add true multi-device real-time synchronization, scheduled recurring sessions, SMS/push delivery, and webhooks without changing the core scheduler.

# Court Rotation Generator

A lightweight browser-based doubles rotation generator for one court.

## Features

- Enter 5–24 player names.
- Generate a one-court doubles rotation.
- Equal games per player when the requested total divides into groups of four.
- Avoids repeating partners within a generated rotation.
- Shows players sitting out for each game.
- Try another randomized arrangement without changing the inputs.
- Works as a static site with no backend or database.
- Includes a mobile-friendly layout.

## Run locally

Open `index.html` directly in a modern browser. No build step is required.

## GitHub Pages

The project can be published with GitHub Pages using the repository's `main` branch and the root (`/`) folder.

## Notes

Opponent matchups can repeat. The generator specifically prioritizes equal playing time and unique partners; avoiding every repeated opponent matchup is not always mathematically possible on one court.

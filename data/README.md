# DrissNow JSON data

These JSON files contain static application configuration and default player-state values.

- `game_config.json` — board and score-credit configuration.
- `feature_config.json` — powerups, themes, and daily challenges.
- `player_state.json` — defaults used when a browser has no feature state yet.

The browser loads these files with `fetch()`. Serve the project through HTTP; do not open `index.html` directly with `file://`.

Dynamic gameplay state remains in the existing browser/server persistence layers. A browser page cannot safely create or overwrite arbitrary JSON files on the server filesystem without a server-side endpoint.

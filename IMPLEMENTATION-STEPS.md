# Drissnow feature rollout

## Step 1 — Safe UI/game layer
1. Copy `feature_manager.js` into `js/`.
2. Copy `feature-ui.css` into `style/` and append it to `style/main.css` (or import it).
3. Use the supplied `index.html` and `application.js`.
4. Test: play, Undo, Shuffle, Hammer, 2x Score, Pause, and themes.

## Step 2 — MariaDB online persistence
1. Run `mariadb-feature-migration.sql` after the existing Peanut schema.
2. Mount `feature-api-routes.js` at `/api/game` after the existing player-ID middleware.
3. Do not modify the working `/api/credits` routes.

## Step 3 — Competition
Leaderboard/friends tables are ready. Add challenge invite/accept/submit endpoints only after Step 2 passes.

## Step 4 — Production
Use HTTPS, real authentication, server-side reward validation, and separate rate limits for competition endpoints.

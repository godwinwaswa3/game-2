# Drissnow feature API integration

1. Keep the existing `src/routes/credits.js` unchanged.
2. Replace `src/routes/feature-api-routes.js` with the included version.
3. Replace the curl proxy with the included `credits_curl_proxy.js`.
4. Replace frontend `feature_manager.js` with the included version.
5. Ensure `index.html` loads `feature-ui.css` and `feature_manager.js`.
6. Keep the server routes mounted as:
   app.use('/api/credits', creditsRoutes);
   app.use('/api/features', featureRoutes);
7. Start the API on port 3000 and the curl proxy on port 3001.
8. Test:
   curl http://localhost:3000/api/features/stats -H "X-Player-Id: test-player-123"
9. Then open Drissnow. Feature stats will load from `/api/features/stats` and sync on game end.

The Credits API remains separate from the feature API.

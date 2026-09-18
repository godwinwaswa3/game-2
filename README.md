# DrissNow JSON data refactor

This rebuild starts from the available DrissNow working source and changes the configuration architecture only: long static configuration objects are loaded from JSON files instead of being embedded in JavaScript functions.

## Important

The browser must load `data/*.json` over HTTP. Do not double-click `index.html`.

Example static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`. Keep the existing Peanut Credits/API proxy running separately on port 3001.

## Data boundaries

JSON is used for static configuration and defaults. MariaDB remains authoritative for the Peanut Unit economy, while existing localStorage/server APIs continue to handle dynamic gameplay state.

## Included

All core browser scripts referenced by `index.html` are included, including the 2048 dependency files that were missing from the previous refactor package.

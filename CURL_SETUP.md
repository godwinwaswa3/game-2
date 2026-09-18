# Drissnow + Peanut Credits using curl

The browser cannot execute `curl` directly. `credits_manager.js` therefore talks to `credits_curl_proxy.js`, and that Node process executes the real `curl` command against the Peanut Credits API.

Architecture:

`Drissnow browser -> curl proxy :3001 -> curl -> Peanut Credits API :3000 -> MariaDB`

## Start

1. Start the Peanut Credits API on port 3000.
2. Make sure the `curl` command is installed and available in PATH.
3. From this folder run:

```bash
node credits_curl_proxy.js
```

4. Open Drissnow in the browser.

To change the API URL:

```bash
PEANUT_CREDITS_API_URL=http://localhost:3000/api/credits node credits_curl_proxy.js
```

To change the proxy port:

```bash
CURL_PROXY_PORT=3001 node credits_curl_proxy.js
```

The credit balance is never calculated or stored by the game. GET `/api/credits` and all POST endpoints remain authoritative.

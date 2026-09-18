/*
 * Peanut Credits curl proxy.
 *
 * Run:
 *   node credits_curl_proxy.js
 *
 * This server is intentionally small and dependency-free. It receives a
 * browser request, executes the system curl command, and returns the API
 * response. The Peanut Credits API itself remains responsible for MariaDB.
 */
var http = require("http");
var { spawn } = require("child_process");

var PORT = Number(process.env.CURL_PROXY_PORT || 3001);
var API_BASE = (process.env.PEANUT_CREDITS_API_URL ||
  "http://localhost:3000/api/credits").replace(/\/$/, "");
var FEATURE_API_BASE = (process.env.DRISSNOW_FEATURE_API_URL ||
  "http://localhost:3000/api/features").replace(/\/$/, "");

var ALLOWED_PATHS = {
  "": true,
  "/use": true,
  "/redeem": true,
  "/milestones": true,
  "/score-bonus": true
};

function sendJson(res, status, value) {
  var text = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON request."));
      }
    });
    req.on("error", reject);
  });
}

function runCurl(request) {
  return new Promise(function (resolve, reject) {
    var base = request.path.indexOf("/game") === 0 ? FEATURE_API_BASE : API_BASE;
    var featurePath = request.path.indexOf("/game") === 0 ? request.path.slice(5) : request.path;
    var target = base + featurePath;
    var args = [
      "-sS",
      "-i",
      "--max-time", "15",
      "-X", request.method,
      "-H", "Accept: application/json",
      "-H", "X-Player-Id: " + request.playerId
    ];

    if (request.body !== undefined && request.body !== null &&
        request.method !== "GET") {
      args.push("-H", "Content-Type: application/json");
      args.push("--data-raw", JSON.stringify(request.body));
    }

    // The target URL MUST be passed to curl.
    args.push(target);

    var child = spawn("curl", args);
    var stdout = [];
    var stderr = [];

    child.stdout.on("data", function (chunk) { stdout.push(chunk); });
    child.stderr.on("data", function (chunk) { stderr.push(chunk); });

    child.on("error", function (error) {
      reject(new Error("curl could not be started: " + error.message));
    });

    child.on("close", function (code) {
      var raw = Buffer.concat(stdout).toString("utf8");
      var errorText = Buffer.concat(stderr).toString("utf8").trim();

      if (code !== 0) {
        reject(new Error(errorText || "curl exited with code " + code));
        return;
      }

      var separator = raw.indexOf("\r\n\r\n");
      var separatorLength = 4;
      if (separator < 0) {
        separator = raw.indexOf("\n\n");
        separatorLength = 2;
      }

      var headerText = separator >= 0 ? raw.slice(0, separator) : "";
      var bodyText = separator >= 0 ? raw.slice(separator + separatorLength) : raw;

      /* curl may return multiple header blocks after redirects. */
      var statusMatches = headerText.match(/HTTP\/[^ ]+ (\d{3})/g) || [];
      var status = statusMatches.length ?
        Number(statusMatches[statusMatches.length - 1].split(" ")[1]) : 200;

      var playerIdMatch = bodyText.match(/^/); // keeps old JS engines happy
      var lines = headerText.split(/\r?\n/);
      var returnedPlayerId = null;
      lines.forEach(function (line) {
        var match = line.match(/^X-Player-Id:\s*(.+)$/i);
        if (match) returnedPlayerId = match[1].trim();
      });

      var data;
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        reject(new Error("Credits API returned invalid JSON."));
        return;
      }

      resolve({ status: status, playerId: returnedPlayerId, data: data });
    });
  });
}

http.createServer(async function (req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST" || req.url !== "/curl") {
    sendJson(res, 404, { success: false, message: "Not found" });
    return;
  }

  try {
    var request = await readBody(req);

    if (!ALLOWED_PATHS[request.path] && request.path.indexOf("/game") !== 0) {
      sendJson(res, 400, { success: false, message: "Unsupported credits API path." });
      return;
    }

    if (!/^(GET|POST)$/.test(request.method)) {
      sendJson(res, 400, { success: false, message: "Unsupported HTTP method." });
      return;
    }

    if (!request.playerId) {
      sendJson(res, 400, { success: false, message: "Player ID is required." });
      return;
    }

    var result = await runCurl(request);
    var response = result.data || {};
    response.success = response.success !== false;

    sendJson(res, result.status, {
      success: result.status >= 200 && result.status < 300,
      playerId: result.playerId,
      data: response,
      message: response.message
    });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      message: error.message || "curl proxy error"
    });
  }
}).listen(PORT, function () {
  console.log("Peanut Credits curl proxy listening on http://localhost:" + PORT);
  console.log("Credits API: " + API_BASE);
  console.log("Feature API: " + FEATURE_API_BASE);
});

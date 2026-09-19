/*
 * DrissNow API / Peanut Credits curl proxy.
 *
 * Architecture:
 *
 *   Browser
 *      |
 *      | HTTP :3001
 *      v
 *   credits_curl_proxy.js
 *      |
 *      | curl
 *      v
 *   DrissNow backend :3000
 *      |
 *      +-- /api/auth
 *      |
 *      +-- /api/credits
 *      |
 *      +-- /api/features
 *      |
 *      v
 *   MariaDB
 *
 *
 * Run:
 *
 *   node credits_curl_proxy.js
 *
 *
 * Default ports:
 *
 *   Proxy:       3001
 *   Backend:     3000
 *
 *
 * Environment variables:
 *
 *   CURL_PROXY_PORT
 *   PEANUT_CREDITS_API_URL
 *   DRISSNOW_FEATURE_API_URL
 *   DRISSNOW_AUTH_API_URL
 *
 */


/* --------------------------------------------------
 * MODULES
 * --------------------------------------------------
 */

var http = require("http");
var spawn = require("child_process").spawn;


/* --------------------------------------------------
 * CONFIGURATION
 * --------------------------------------------------
 *
 * IMPORTANT:
 *
 * The proxy must NOT run on the same port as the
 * backend API.
 *
 * Backend:
 *
 *   3000
 *
 * Proxy:
 *
 *   3001
 *
 */

var PORT =
  Number(
    process.env.CURL_PROXY_PORT || 3001
  );


/*
 * Actual Peanut Credits backend.
 */

var API_BASE =
  (
    process.env.PEANUT_CREDITS_API_URL ||
    "http://127.0.0.1:3000/api/credits"
  ).replace(/\/$/, "");


/*
 * Actual Feature backend.
 */

var FEATURE_API_BASE =
  (
    process.env.DRISSNOW_FEATURE_API_URL ||
    "http://127.0.0.1:3000/api/features"
  ).replace(/\/$/, "");


/*
 * Actual authentication backend.
 */

var AUTH_API_BASE =
  (
    process.env.DRISSNOW_AUTH_API_URL ||
    "http://127.0.0.1:3000/api/auth"
  ).replace(/\/$/, "");


/* --------------------------------------------------
 * ALLOWED CREDIT PATHS
 * --------------------------------------------------
 */

var ALLOWED_PATHS = {

  "": true,

  "/use": true,

  "/redeem": true,

  "/milestones": true,

  "/score-bonus": true

};


/* --------------------------------------------------
 * ALLOWED AUTH ROUTES
 * --------------------------------------------------
 */

var AUTH_ROUTES = {

  "/signin": {
    method: "POST"
  },

  "/signup": {
    method: "POST"
  },

  "/me": {
    method: "GET"
  },

  "/signout": {
    method: "POST"
  }

};


/* --------------------------------------------------
 * RESPONSE HELPERS
 * --------------------------------------------------
 */

function sendJson(
  res,
  status,
  value
) {

  var text =
    JSON.stringify(value);


  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Player-Id",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",

      "Access-Control-Expose-Headers":
        "X-Player-Id",

      "Content-Length":
        Buffer.byteLength(text)
    }
  );


  res.end(text);

}


/* --------------------------------------------------
 * BODY READER
 * --------------------------------------------------
 */

function readBody(req) {

  return new Promise(
    function (resolve, reject) {

      var chunks = [];


      req.on(
        "data",
        function (chunk) {

          chunks.push(chunk);

        }
      );


      req.on(
        "end",
        function () {

          var raw =
            Buffer
              .concat(chunks)
              .toString("utf8");


          /*
           * Empty request body is valid for
           * GET /me and POST /signout.
           */

          if (!raw.trim()) {

            resolve({});

            return;

          }


          try {

            resolve(
              JSON.parse(raw)
            );

          } catch (error) {

            reject(
              new Error(
                "Invalid JSON request."
              )
            );

          }

        }
      );


      req.on(
        "error",
        reject
      );

    }
  );

}


/* --------------------------------------------------
 * AUTHORIZATION HEADER
 * --------------------------------------------------
 */

function getAuthorizationHeader(req) {

  return String(
    req.headers.authorization || ""
  );

}


/* --------------------------------------------------
 * CURL RESPONSE PARSER
 * --------------------------------------------------
 */

function parseCurlResponse(raw) {

  var separator =
    raw.indexOf("\r\n\r\n");


  var separatorLength = 4;


  if (separator < 0) {

    separator =
      raw.indexOf("\n\n");

    separatorLength = 2;

  }


  var headerText =
    separator >= 0
      ? raw.slice(0, separator)
      : "";


  var bodyText =
    separator >= 0
      ? raw.slice(
          separator + separatorLength
        )
      : raw;


  /*
   * curl may return multiple HTTP header
   * blocks after redirects.
   */

  var statusMatches =
    headerText.match(
      /HTTP\/[^ ]+ (\d{3})/g
    ) || [];


  var status =
    statusMatches.length
      ? Number(
          statusMatches[
            statusMatches.length - 1
          ].split(" ")[1]
        )
      : 200;


  /*
   * Read X-Player-Id if the backend sends it.
   */

  var lines =
    headerText.split(/\r?\n/);


  var returnedPlayerId =
    null;


  lines.forEach(
    function (line) {

      var match =
        line.match(
          /^X-Player-Id:\s*(.+)$/i
        );


      if (match) {

        returnedPlayerId =
          match[1].trim();

      }

    }
  );


  var data;


  try {

    data =
      JSON.parse(
        bodyText
      );

  } catch (error) {

    throw new Error(
      "Backend returned invalid JSON."
    );

  }


  return {

    status:
      status,

    playerId:
      returnedPlayerId,

    data:
      data

  };

}


/* --------------------------------------------------
 * GENERIC CURL REQUEST
 * --------------------------------------------------
 */

function runCurl(options) {

  return new Promise(
    function (resolve, reject) {

      var args = [

        "-sS",

        "-i",

        "--max-time",
        "15",

        "-X",
        options.method,

        "-H",
        "Accept: application/json"

      ];


      /*
       * Forward Authorization when present.
       */

      if (
        options.authorization
      ) {

        args.push(
          "-H",
          "Authorization: " +
          options.authorization
        );

      }


      /*
       * Forward player ID when supplied.
       */

      if (
        options.playerId
      ) {

        args.push(
          "-H",
          "X-Player-Id: " +
          options.playerId
        );

      }


      /*
       * Send JSON body for POST requests.
       */

      if (
        options.body !== undefined &&
        options.body !== null &&
        options.method !== "GET"
      ) {

        args.push(
          "-H",
          "Content-Type: application/json"
        );


        args.push(
          "--data-raw",
          JSON.stringify(
            options.body
          )
        );

      }


      /*
       * The target URL MUST be the final argument.
       */

      args.push(
        options.target
      );


      var child =
        spawn(
          "curl",
          args
        );


      var stdout = [];

      var stderr = [];


      child.stdout.on(
        "data",
        function (chunk) {

          stdout.push(chunk);

        }
      );


      child.stderr.on(
        "data",
        function (chunk) {

          stderr.push(chunk);

        }
      );


      child.on(
        "error",
        function (error) {

          reject(
            new Error(
              "curl could not be started: " +
              error.message
            )
          );

        }
      );


      child.on(
        "close",
        function (code) {

          var raw =
            Buffer
              .concat(stdout)
              .toString("utf8");


          var errorText =
            Buffer
              .concat(stderr)
              .toString("utf8")
              .trim();


          if (code !== 0) {

            reject(
              new Error(
                errorText ||
                "curl exited with code " +
                code
              )
            );

            return;

          }


          try {

            var parsed =
              parseCurlResponse(
                raw
              );


            resolve(parsed);

          } catch (error) {

            reject(error);

          }

        }
      );

    }
  );

}


/* --------------------------------------------------
 * AUTHENTICATION ROUTE
 * --------------------------------------------------
 *
 * These routes are exposed directly:
 *
 *   POST /api/auth/signin
 *   POST /api/auth/signup
 *   GET  /api/auth/me
 *   POST /api/auth/signout
 *
 *
 * The response from the backend is returned
 * directly to the browser.
 *
 * This is important because signin.html expects:
 *
 *   data.success
 *   data.token
 *   data.user
 *
 * rather than:
 *
 *   data.data.success
 *   data.data.token
 *   data.data.user
 *
 */

async function handleAuthRoute(
  req,
  res,
  pathname
) {

  var route =
    AUTH_ROUTES[pathname];


  if (!route) {

    sendJson(
      res,
      404,
      {
        success: false,
        message:
          "Authentication route not found."
      }
    );

    return;

  }


  /*
   * Verify HTTP method.
   */

  if (
    req.method !== route.method
  ) {

    sendJson(
      res,
      405,
      {
        success: false,
        message:
          "Method not allowed."
      }
    );

    return;

  }


  try {

    var body =
      await readBody(req);


    var result =
      await runCurl({

        method:
          req.method,

        target:
          AUTH_API_BASE +
          pathname,

        body:
          body,

        authorization:
          getAuthorizationHeader(req)

      });


    /*
     * Return the authentication backend
     * response directly.
     */

    res.writeHead(
      result.status,
      {
        "Content-Type":
          "application/json; charset=utf-8",

        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Player-Id",

        "Access-Control-Allow-Methods":
          "GET, POST, OPTIONS",

        "Access-Control-Expose-Headers":
          "X-Player-Id",

        "Content-Length":
          Buffer.byteLength(
            JSON.stringify(
              result.data
            )
          )
      }
    );


    res.end(
      JSON.stringify(
        result.data
      )
    );


  } catch (error) {

    console.error(
      "Authentication proxy error:",
      error
    );


    sendJson(
      res,
      502,
      {
        success: false,
        message:
          error.message ||
          "Authentication proxy error."
      }
    );

  }

}


/* --------------------------------------------------
 * CREDIT / FEATURE CURL ROUTE
 * --------------------------------------------------
 *
 * Browser sends:
 *
 * POST /curl
 *
 * Example body:
 *
 * {
 *   "path": "/",
 *   "method": "GET",
 *   "playerId": "..."
 * }
 *
 * Or:
 *
 * {
 *   "path": "/use",
 *   "method": "POST",
 *   "playerId": "...",
 *   "body": {...}
 * }
 *
 */

async function handleCurlRoute(
  req,
  res
) {

  if (
    req.method !== "POST"
  ) {

    sendJson(
      res,
      405,
      {
        success: false,
        message:
          "Method not allowed."
      }
    );

    return;

  }


  try {

    var request =
      await readBody(req);


    request.path =
      String(
        request.path || ""
      );


    request.method =
      String(
        request.method || "GET"
      ).toUpperCase();


    /*
     * Check allowed paths.
     */

    var isFeaturePath =
      request.path.indexOf(
        "/game"
      ) === 0;


    var isCreditPath =
      !!ALLOWED_PATHS[
        request.path
      ];


    if (
      !isCreditPath &&
      !isFeaturePath
    ) {

      sendJson(
        res,
        400,
        {
          success: false,
          message:
            "Unsupported credits API path."
        }
      );

      return;

    }


    /*
     * Only GET and POST are supported.
     */

    if (
      !/^(GET|POST)$/.test(
        request.method
      )
    ) {

      sendJson(
        res,
        400,
        {
          success: false,
          message:
            "Unsupported HTTP method."
        }
      );

      return;

    }


    /*
     * Existing CreditsManager requests require
     * a player ID.
     */

    if (
      !request.playerId
    ) {

      sendJson(
        res,
        400,
        {
          success: false,
          message:
            "Player ID is required."
        }
      );

      return;

    }


    /*
     * Select backend.
     */

    var base;

    var targetPath;


    if (isFeaturePath) {

      base =
        FEATURE_API_BASE;


      /*
       * /game/foo
       *
       * becomes:
       *
       * /foo
       */

      targetPath =
        request.path.slice(5);

    } else {

      base =
        API_BASE;


      targetPath =
        request.path;

    }


    var target =
      base +
      targetPath;


    /*
     * Forward Authorization too.
     *
     * This makes CreditsManager compatible
     * with authenticated backend routes.
     */

    var result =
      await runCurl({

        method:
          request.method,

        target:
          target,

        playerId:
          request.playerId,

        body:
          request.body,

        authorization:
          request.authorization ||
          ""

      });


    var response =
      result.data || {};


    /*
     * Preserve the old proxy response
     * format expected by CreditsManager.
     */

    response.success =
      response.success !== false;


    sendJson(
      res,
      result.status,
      {
        success:
          result.status >= 200 &&
          result.status < 300,

        playerId:
          result.playerId,

        data:
          response,

        message:
          response.message

      }
    );


  } catch (error) {

    console.error(
      "Credits proxy error:",
      error
    );


    sendJson(
      res,
      502,
      {
        success: false,
        message:
          error.message ||
          "curl proxy error"
      }
    );

  }

}


/* --------------------------------------------------
 * MAIN HTTP SERVER
 * --------------------------------------------------
 */

var server =
  http.createServer(
    async function (req, res) {

      /*
       * CORS preflight.
       */

      if (
        req.method === "OPTIONS"
      ) {

        res.writeHead(
          204,
          {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Player-Id",

            "Access-Control-Allow-Methods":
              "GET, POST, OPTIONS"
          }
        );


        res.end();

        return;

      }


      /*
       * Remove query string.
       */

      var pathname =
        String(
          req.url || "/"
        ).split("?")[0];


      /*
       * --------------------------------------------
       * AUTH ROUTES
       * --------------------------------------------
       */

      if (
        pathname.indexOf(
          "/api/auth/"
        ) === 0
      ) {

        await handleAuthRoute(
          req,
          res,
          pathname.slice(
            "/api/auth".length
          )
        );

        return;

      }


      /*
       * --------------------------------------------
       * CURL ROUTE
       * --------------------------------------------
       */

      if (
        pathname === "/curl"
      ) {

        await handleCurlRoute(
          req,
          res
        );

        return;

      }


      /*
       * --------------------------------------------
       * HEALTH CHECK
       * --------------------------------------------
       */

      if (
        pathname === "/health"
      ) {

        sendJson(
          res,
          200,
          {
            success: true,
            status: "ok"
          }
        );

        return;

      }


      /*
       * Everything else.
       */

      sendJson(
        res,
        404,
        {
          success: false,
          message: "Not found"
        }
      );

    }
  );


/* --------------------------------------------------
 * SERVER ERROR HANDLING
 * --------------------------------------------------
 */

server.on(
  "error",
  function (error) {

    if (
      error.code === "EADDRINUSE"
    ) {

      console.error(
        "ERROR: Port " +
        PORT +
        " is already in use."
      );


      console.error(
        "Choose another CURL_PROXY_PORT " +
        "or stop the existing proxy."
      );


      return;

    }


    console.error(
      "Proxy server error:",
      error
    );

  }
);


/* --------------------------------------------------
 * START
 * --------------------------------------------------
 */

server.listen(
  PORT,
  "127.0.0.1",
  function () {

    console.log(
      "DrissNow API proxy listening on " +
      "http://127.0.0.1:" +
      PORT
    );


    console.log(
      "Authentication API: " +
      AUTH_API_BASE
    );


    console.log(
      "Credits API: " +
      API_BASE
    );


    console.log(
      "Feature API: " +
      FEATURE_API_BASE
    );

  }
);
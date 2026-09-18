(function(window) {
  "use strict";

  /*
   * Drissnow Credit Economy
   *
   * MariaDB economy_config is the single source of truth for:
   *
   *   initial_balance
   *   interest_rate
   *   compound_seconds
   *   plot_interval_seconds
   *   duration_seconds
   *
   * The browser never overrides those values with a game-manager
   * duration or a hardcoded round duration.
   */

  function DrissnowCreditEconomy() {
    this.playerId = null;
    this.sessionId = null;

    /*
     * These are only empty startup values.
     *
     * They are replaced by MariaDB before a real economy session starts.
     * In particular, durationSeconds starts as null so there is no
     * client-side 30/90-second duration.
     */
    this.config = {
      initialBalance: null,
      interestRate: null,
      compoundSeconds: null,
      plotIntervalSeconds: null,
      durationSeconds: null
    };

    this.startedAt = null;
    this.roundEndTime = null;

    this.units = 0;

    this.scoreAtLastSnapshot = 0;

    this.gameScoreProvider = null;

    this.timer = null;
    this.snapshotTimer = null;
    this.animationFrameId = null;

    this.container = null;
    this.canvas = null;
    this.ctx = null;

    this.unitsElement = null;
    this.countdownElement = null;
    this.scoreElement = null;
    this.finalElement = null;

    /*
     * Only the database session ID is stored locally.
     *
     * The actual economy configuration remains server/database
     * authoritative.
     */
    this.storageKey =
      "drissnowEconomySessionId";

    this.points = [];

    this.lastSnapshotSlot = -1;

    this.running = false;
  };


  // ============================================================
// JSON FILE PERSISTENCE
// ============================================================

DrissnowCreditEconomy.prototype.saveJsonState =
  async function() {

    if (!this.playerId) {
      return null;
    }

    try {
      return await this.apiRequest(
        "/economy/json-save",
        "POST",
        {
          sessionId:
            this.sessionId,

          startedAt:
            this.startedAt,

          roundEndTime:
            this.roundEndTime,

          durationSeconds:
            Number(
              this.config.durationSeconds
            ) || 0,

          units:
            Number(
              this.units
            ) || 0,

          scoreAtLastSnapshot:
            Number(
              this.scoreAtLastSnapshot
            ) || 0,

          lastSnapshotSlot:
            Number(
              this.lastSnapshotSlot
            ),

          points:
            Array.isArray(this.points)
              ? this.points
              : []
        }
      );

    } catch (error) {

      console.warn(
        "Economy JSON save failed:",
        error
      );

      return null;
    }
  };


  //load json state
  DrissnowCreditEconomy.prototype.loadJsonState =
  async function() {

    if (!this.playerId) {
      return null;
    }

    try {

      var data =
        await this.apiRequest(
          "/economy/json-load",
          "POST",
          {}
        );

      if (
        !data ||
        !data.success ||
        !data.found ||
        !data.state
      ) {
        return null;
      }

      var state =
        data.state;

      /*
       * Only restore an active-looking state.
       */
      if (
        state.sessionId === null ||
        state.sessionId === undefined
      ) {
        return null;
      }

      this.sessionId =
        Number(state.sessionId);

      this.startedAt =
        Number(state.startedAt);

      this.roundEndTime =
        Number(state.roundEndTime);

      this.units =
        Number(state.units) || 0;

      this.scoreAtLastSnapshot =
        Number(
          state.scoreAtLastSnapshot
        ) || 0;

      this.lastSnapshotSlot =
        Number(
          state.lastSnapshotSlot
        );

      if (
        !isFinite(
          this.startedAt
        )
      ) {
        return null;
      }

      if (
        !isFinite(
          this.roundEndTime
        )
      ) {
        this.roundEndTime =
          this.startedAt +
          Number(
            this.config.durationSeconds
          ) *
          1000;
      }

      /*
       * Restore the complete graph.
       */
      if (
        Array.isArray(state.points)
      ) {

        this.points =
          state.points
            .map(function(point) {

              return {
                seconds:
                  Number(
                    point.seconds
                  ) || 0,

                amount:
                  Number(
                    point.amount
                  ) || 0,

                compoundAmount:
                  Number(
                    point.compoundAmount
                  ) || 0,

                score:
                  Number(
                    point.score
                  ) || 0
              };

            })
            .filter(function(point) {

              return (
                isFinite(point.seconds) &&
                isFinite(point.amount)
              );

            });

      } else {

        this.points = [];
      }

      this.points.sort(
        function(a, b) {
          return (
            a.seconds -
            b.seconds
          );
        }
      );

      this.render();

      return state;

    } catch (error) {

      console.warn(
        "Economy JSON load failed:",
        error
      );

      return null;
    }
  };

  /*
   * Create the economy watch UI.
   */
  DrissnowCreditEconomy.prototype.mount =
    function() {
      var self = this;

      this.container =
        document.getElementById(
          "drissnow-features"
        );

      if (!this.container) return;

      var oldWatch =
        this.container.querySelector(
          ".economy-watch"
        );

      if (oldWatch) {
        oldWatch.remove();
      }

      var watch =
        document.createElement(
          "div"
        );

      watch.className =
        "economy-watch";

      watch.innerHTML =
        "<strong>Peanut Units</strong>" +
        "<div>Current amount: " +
        "<span class=\"economy-units\">" +
        "0.000000" +
        "</span></div>" +
        "<div>Time remaining: " +
        "<span class=\"economy-countdown\">" +
        "--" +
        "</span></div>" +
        "<div>Game score added: " +
        "<span class=\"economy-score\">" +
        "0" +
        "</span></div>" +
        "<canvas class=\"economy-chart\">" +
        "</canvas>" +
        "<div>Final amount: " +
        "<span class=\"economy-final\">" +
        "--" +
        "</span></div>";

      this.container.appendChild(
        watch
      );

      this.unitsElement =
        watch.querySelector(
          ".economy-units"
        );

      this.countdownElement =
        watch.querySelector(
          ".economy-countdown"
        );

      this.scoreElement =
        watch.querySelector(
          ".economy-score"
        );

      this.finalElement =
        watch.querySelector(
          ".economy-final"
        );

      this.canvas =
        watch.querySelector(
          ".economy-chart"
        );

      if (this.canvas) {
        this.ctx =
          this.canvas.getContext(
            "2d"
          );
      }

      this.resize();

      window.addEventListener(
        "resize",
        function() {
          self.resize();
        }
      );
    };

  /*
   * Resize the canvas for the current device.
   */
  DrissnowCreditEconomy.prototype.resize =
    function() {
      if (
        !this.canvas ||
        !this.ctx
      ) {
        return;
      }

      var rect =
        this.canvas.getBoundingClientRect();

      var width =
        Math.max(
          1,
          Math.round(
            rect.width || 300
          )
        );

      var height =
        Math.max(
          1,
          Math.round(
            rect.height || 180
          )
        );

      var ratio =
        window.devicePixelRatio || 1;

      this.canvas.width =
        width * ratio;

      this.canvas.height =
        height * ratio;

      this.canvas.style.width =
        width + "px";

      this.canvas.style.height =
        height + "px";

      this.ctx.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
      );

      this.drawChart();
    };

  /*
   * Load the economy configuration directly from MariaDB
   * through the feature API.
   */
DrissnowCreditEconomy.prototype.loadConfig = async function() {
  console.log(
    "[Drissnow Economy] Loading economy configuration..."
  );

  var data = await this.apiRequest(
    "/economy/config",
    "GET",
    {}
  );

  console.log(
    "[Drissnow Economy] CONFIG RESPONSE:",
    data
  );

  console.log(
    "[Drissnow Economy] CONFIG OBJECT:",
    data && data.config
  );

  console.log(
    "[Drissnow Economy] CURRENT CONFIG BEFORE APPLY:",
    this.config
  );

  if (data && data.config) {
    this.applyConfig(data.config);
  }

  console.log(
    "[Drissnow Economy] CURRENT CONFIG AFTER APPLY:",
    this.config
  );

  return this.config;
};  /*
   * Apply configuration returned by MariaDB.
   *
   * Supports both snake_case database/API values and camelCase
   * values returned by the feature route.
   */
  DrissnowCreditEconomy.prototype.applyConfig =
    function(config) {
      if (!config) return;

      var initial =
        Number(
          config.initial_balance !==
          undefined
            ? config.initial_balance
            : config.initialBalance
        );

      var rate =
        Number(
          config.interest_rate !==
          undefined
            ? config.interest_rate
            : config.interestRate
        );

      var compound =
        Number(
          config.compound_seconds !==
          undefined
            ? config.compound_seconds
            : config.compoundSeconds
        );

      var interval =
        Number(
          config.plot_interval_seconds !==
          undefined
            ? config.plot_interval_seconds
            : config.plotIntervalSeconds
        );

      var duration =
        Number(
          config.duration_seconds !==
          undefined
            ? config.duration_seconds
            : config.durationSeconds
        );

      if (
        isFinite(initial) &&
        initial >= 0
      ) {
        this.config.initialBalance =
          initial;
      }

      if (
        isFinite(rate) &&
        rate >= 0
      ) {
        this.config.interestRate =
          rate;
      }

      if (
        isFinite(compound) &&
        compound > 0
      ) {
        this.config.compoundSeconds =
          compound;
      }

      if (
        isFinite(interval) &&
        interval > 0
      ) {
        this.config.plotIntervalSeconds =
          interval;
      }

      if (
        isFinite(duration) &&
        duration > 0
      ) {
        /*
         * IMPORTANT:
         *
         * This value comes from MariaDB.
         *
         * Nothing supplied by GameManager is allowed to overwrite it.
         */
        this.config.durationSeconds =
          duration;
      }
    };

  /*
   * API helper.
   *
   * The curl proxy routes /game/* to:
   *
   *   /api/features/*
   */
DrissnowCreditEconomy.prototype.apiRequest = async function(
  path,
  method,
  body
) {
  var requestBody = {
    path: "/game" + path,
    method: method || "GET",
    playerId: this.playerId,
    body: body || {}
  };

  console.log(
    "[Drissnow Economy] REQUEST → /curl:",
    requestBody
  );

  console.log(
    "[Drissnow Economy] REQUEST JSON:",
    JSON.stringify(requestBody)
  );

  var response = await fetch(
    "http://localhost:3001/curl",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }
  );

  console.log(
    "[Drissnow Economy] HTTP status:",
    response.status,
    response.statusText
  );

  var rawText = await response.text();

  console.log(
    "[Drissnow Economy] RAW API RESPONSE:",
    rawText
  );

  var wrapper;

  try {
    wrapper = JSON.parse(rawText);
  } catch (error) {
    console.error(
      "[Drissnow Economy] Invalid JSON response:",
      error
    );
    throw error;
  }

  console.log(
    "[Drissnow Economy] PARSED API RESPONSE:",
    wrapper
  );

  // The curl proxy wraps the actual API response in "data".
  if (
    wrapper &&
    wrapper.success === true &&
    wrapper.data !== undefined
  ) {
    console.log(
      "[Drissnow Economy] UNWRAPPED API DATA:",
      wrapper.data
    );

    return wrapper.data;
  }

  return wrapper;
};

  /*
   * Get locally stored database session ID.
   */
  DrissnowCreditEconomy.prototype.getStoredSessionId =
    function() {
      try {
        return window.localStorage.getItem(
          this.storageKey
        );
      } catch (error) {
        return null;
      }
    };

  /*
   * Store only the database session identity.
   */
  DrissnowCreditEconomy.prototype.storeSessionId =
    function(sessionId) {
      if (!sessionId) return;

      try {
        window.localStorage.setItem(
          this.storageKey,
          String(sessionId)
        );
      } catch (error) {
        /*
         * Local storage is optional.
         * The database remains authoritative.
         */
      }
    };

  /*
   * Remove the stored session identity.
   */
  DrissnowCreditEconomy.prototype.clearStoredSessionId =
    function() {
      try {
        window.localStorage.removeItem(
          this.storageKey
        );
      } catch (error) {
        /*
         * Ignore storage failures.
         */
      }
    };

  /*
   * Calculate compound economy amount.
   *
   * A(t) =
   *   initialBalance *
   *   (1 + interestRate) ^
   *   (seconds / compoundSeconds)
   */
  DrissnowCreditEconomy.prototype.amount =
    function(seconds) {
      var initial =
        Number(
          this.config.initialBalance
        );

      var rate =
        Number(
          this.config.interestRate
        );

      var period =
        Number(
          this.config.compoundSeconds
        );

      if (
        !isFinite(initial) ||
        !isFinite(rate) ||
        !isFinite(period) ||
        period <= 0
      ) {
        return 0;
      }

      seconds =
        Math.max(
          0,
          Number(seconds) || 0
        );

      return (
        initial *
        Math.pow(
          1 + rate,
          seconds / period
        )
      );
    };

  /*
   * Calculate real elapsed time.
   *
   * IMPORTANT:
   * There is no 30-second fallback.
   *
   * durationSeconds must come from MariaDB.
   */
  DrissnowCreditEconomy.prototype.elapsed =
    function() {
      if (!this.startedAt) {
        return 0;
      }

      var seconds =
        (
          Date.now() -
          this.startedAt
        ) / 1000;

      var duration =
        Number(
          this.config.durationSeconds
        );

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        return 0;
      }

      return Math.max(
        0,
        Math.min(
          duration,
          seconds
        )
      );
    };

  /*
   * Read the current 2048 score.
   */
  DrissnowCreditEconomy.prototype.currentScore =
    function() {
      if (!this.gameScoreProvider) {
        return 0;
      }

      var score =
        Number(
          this.gameScoreProvider()
        );

      if (!isFinite(score)) {
        return 0;
      }

      return Math.max(
        0,
        score
      );
    };

  /*
   * Current live amount.
   */
  DrissnowCreditEconomy.prototype.currentAmount =
    function() {
      return (
        this.amount(
          this.elapsed()
        ) +
        this.scoreAtLastSnapshot
      );
    };

  /*
   * Start a new database economy session.
   *
   * durationSeconds is intentionally retained as an unused compatibility
   * argument because older FeatureManager versions may still pass it.
   *
   * MariaDB duration ALWAYS wins.
   */
  DrissnowCreditEconomy.prototype.start =
    async function(
      playerId,
      roundEndTime,
      durationSeconds,
      isResume
    ) {
      /*
       * Prevent JSHint/older callers from treating the fourth argument
       * as the duration source.
       *
       * The value is deliberately ignored.
       */
/*
 * A redeemed code can provide the duration for this
 * fresh economy session.
 *
 * The database economy_config remains the fallback.
 */
var codeDuration =
  Number(durationSeconds);

if (
  !isFinite(codeDuration) ||
  codeDuration <= 0
) {
  codeDuration = null;
}
      this.playerId =
        playerId;

      this.roundEndTime =
        roundEndTime || null;

      this.stopLoops();

      this.sessionId = null;

      this.startedAt = null;

      this.units = 0;

      this.scoreAtLastSnapshot = 0;

      this.lastSnapshotSlot = -1;

      this.points = [];

      this.running = false;

      try {
        /*
         * FIRST:
         *
         * Load configuration from MariaDB.
         */
        await this.loadConfig();
        /*
 * economy_config is the DEFAULT.
 *
 * A valid redeemed-code duration overrides it
 * for this session.
 */
if (
  codeDuration !== null
) {
  this.config.durationSeconds =
    codeDuration;

  console.log(
    "[DrissNow] Economy duration overridden by redeemed code:",
    codeDuration,
    "seconds"
  );
}

        /*
         * SECOND:
         *
         * If this is a page-refresh resume, try restoring
         * the existing database session.
         */
        if (isResume) {
          var resumed =
            await this.resume(
              playerId,
              roundEndTime
            );

          if (resumed) {
            return resumed;
          }
        }

        /*
         * THIRD:
         *
         * Start a brand-new database economy session.
         *
         * No duration is sent by the browser.
         *
         * The server reads duration_seconds from MariaDB.
         */
var data = await this.apiRequest(
  "/economy/start",
  "POST",
  {}
);
        
//temporarily
console.log(
  "[Drissnow Economy] START RESPONSE:",
  data
);

console.log(
  "[Drissnow Economy] START SESSION:",
  data && data.session
);

if (
  !data ||
  !data.success ||
  !data.sessionId
) {
  throw new Error(
    data && data.message
      ? data.message
      : "Unable to start economy session"
  );
}

        this.loadSessionResponse(
          data,
          roundEndTime
        );
        /*
 * The server session/config is the fallback configuration.
 *
 * For a redeemed round, the code duration remains
 * authoritative for the browser session.
 */
if (
  codeDuration !== null
) {
  this.config.durationSeconds =
    codeDuration;

  console.log(
    "[DrissNow] Session duration restored to redeemed-code duration:",
    codeDuration,
    "seconds"
  );
}

        this.storeSessionId(
          this.sessionId
        );

        this.plotSnapshot();

        this.startLoop();

        return data;
      } catch (error) {
        console.error(
          "Economy start error:",
          error
        );

        /*
         * Do NOT fabricate a local economy session if the database
         * cannot be reached.
         *
         * This is important because the economy amount and duration
         * are supposed to be authoritative database values.
         */
        this.stopLoops();

        this.startedAt = null;

        this.sessionId = null;

        this.roundEndTime = null;

        this.units = 0;

        this.points = [];

        this.render();

        return null;
      }
    };

  /*
   * Restore an active economy session from the database.
   */
  DrissnowCreditEconomy.prototype.resume =
    async function(
      playerId,
      roundEndTime
    ) {
      this.playerId =
        playerId || this.playerId;

      var storedSessionId =
        this.getStoredSessionId();

      var body = {};

      if (storedSessionId) {
        body.sessionId =
          storedSessionId;
      }

      try {
        var data =
          await this.apiRequest(
            "/economy/resume",
            "POST",
            body
          );

        if (
          !data ||
          !data.success ||
          !data.session
        ) {
          this.clearStoredSessionId();

          return null;
        }

        this.loadSessionResponse(
          data,
          roundEndTime
        );

        await this.loadPersistedSnapshots();

        /*
         * If the server says the round has already ended,
         * do not restart it.
         */
        if (
          this.elapsed() >=
          Number(
            this.config.durationSeconds
          )
        ) {
          await this.refreshFinalState();

          this.render();

          return data;
        }

        this.startLoop();

        this.render();

        return data;
      } catch (error) {
        console.error(
          "Economy resume error:",
          error
        );

        return null;
      }
    };

  /*
   * Load a server session response.
   */
/*
 * Load a server session response.
 */
DrissnowCreditEconomy.prototype.loadSessionResponse =
  function(
    data,
    requestedEndTime
  ) {
    /*
     * The curl proxy is unwrapped by apiRequest(), so `data` is the
     * actual economy API response.
     *
     * New economy/start responses return the session fields directly,
     * rather than inside data.session.
     */
    var session;

    if (data && data.session) {
      session = data.session;
    } else {
      session = data || {};
    }

    var config =
      data && data.config ||
      session.config;

    if (config) {
      this.applyConfig(
        config
      );
    }

    /*
     * The economy API returns baseBalance directly.
     */
    if (
      session.baseBalance !==
        undefined &&
      session.baseBalance !==
        null
    ) {
      this.config.initialBalance =
        Number(
          session.baseBalance
        );
    }

    /*
     * Support both:
     *   startedAtMs
     * and the current API's:
     *   startedAt
     */
    if (
      session.startedAtMs !==
        undefined &&
      session.startedAtMs !==
        null
    ) {
      this.startedAt =
        Number(
          session.startedAtMs
        );
    } else if (
      session.startedAt !==
        undefined &&
      session.startedAt !==
        null
    ) {
      this.startedAt =
        new Date(
          session.startedAt
        ).getTime();
    }

    if (!isFinite(
      this.startedAt
    )) {
      this.startedAt =
        Date.now();
    }

    /*
     * Support both the older nested session.id format and
     * the current API's direct sessionId format.
     */
    if (
      session.id !==
        undefined &&
      session.id !==
        null
    ) {
      this.sessionId =
        session.id;
    } else if (
      data &&
      data.sessionId !==
        undefined &&
      data.sessionId !==
        null
    ) {
      this.sessionId =
        data.sessionId;
    }

    /*
     * For an existing game, the GameManager's persisted absolute
     * end time is authoritative for that already-running round.
     *
     * For a new session, the server/database duration is used.
     */
    if (requestedEndTime) {
      this.roundEndTime =
        requestedEndTime;
    } else if (
      data &&
      data.roundEndTimeMs
    ) {
      this.roundEndTime =
        Number(
          data.roundEndTimeMs
        );
    } else {
      this.roundEndTime =
        this.startedAt +
        Number(
          this.config.durationSeconds
        ) *
        1000;
    }

    this.storeSessionId(
      this.sessionId
    );
  };

  /*
   * Load official snapshots stored in MariaDB.
   */
  DrissnowCreditEconomy.prototype.loadPersistedSnapshots =
    async function() {
      if (!this.sessionId) {
        return null;
      }

      try {
        var data =
          await this.apiRequest(
            "/economy/snapshots",
            "POST",
            {
              sessionId:
                this.sessionId
            }
          );

        var snapshots =
          data &&
          (
            data.snapshots ||
            (
              data.session &&
              data.session.snapshots
            )
          );

        if (
          !Array.isArray(
            snapshots
          )
        ) {
          return data;
        }

        this.points = [];

        for (
          var i = 0;
          i < snapshots.length;
          i++
        ) {
          var row =
            snapshots[i] || {};

          var seconds =
            Number(
              row.elapsed_seconds !==
              undefined
                ? row.elapsed_seconds
                : row.elapsedSeconds
            );

          var amount =
            Number(
              row.amount
            );

          if (
            !isFinite(seconds) ||
            !isFinite(amount)
          ) {
            continue;
          }

          var score =
            Number(
              row.score !==
              undefined
                ? row.score
                : 0
            );

          var compoundAmount =
            Number(
              row.compound_amount !==
              undefined
                ? row.compound_amount
                : row.compoundAmount
            );

          if (!isFinite(score)) {
            score = 0;
          }

          if (
            !isFinite(
              compoundAmount
            )
          ) {
            compoundAmount =
              Math.max(
                0,
                amount - score
              );
          }

          this.points.push({
            seconds:
              seconds,

            amount:
              amount,

            compoundAmount:
              compoundAmount,

            score:
              score
          });
        }

        this.points.sort(
          function(a, b) {
            return (
              a.seconds -
              b.seconds
            );
          }
        );

        if (
          this.points.length
        ) {
          var last =
            this.points[
              this.points.length - 1
            ];

          this.lastSnapshotSlot =
            last.seconds;

         this.scoreAtLastSnapshot =
  Math.max(
    0,
    (Number(last.score) || 0) / 3
  );

          this.units =
            Number(
              last.amount
            ) || 0;
        }

        this.render();

        return data;
      } catch (error) {
        console.warn(
          "Economy snapshots could not be loaded:",
          error
        );

        return null;
      }
    };



  /*
 * Resume the currently active economy session.
 *
 * This is used when the game itself survived a page refresh.
 * The existing database session remains authoritative.
 *
 * IMPORTANT:
 * - Do not create a new economy session.
 * - Restore the existing graph points.
 * - Restore the original start time.
 * - Restore the game's absolute end time.
 * - Restart the live economy loop.
 */
DrissnowCreditEconomy.prototype.resumeExistingSession =
  async function(roundEndTime) {

    if (!this.sessionId) {
      return null;
    }

    try {
      /*
       * The game's persisted end timestamp is authoritative.
       */
      if (roundEndTime) {
        this.roundEndTime =
          Number(roundEndTime);
      }

      /*
       * Reload the existing session from the server.
       *
       * This restores:
       *   sessionId
       *   startedAt
       *   base balance
       *   economy configuration
       */
      var sessionData =
        await this.apiRequest(
          "/economy/session",
          "POST",
          {
            sessionId:
              this.sessionId
          }
        );

      if (
        sessionData &&
        sessionData.success
      ) {
        this.loadSessionResponse(
          sessionData,
          roundEndTime
        );
      }

      /*
       * Reload every saved chart point.
       */
      await this.loadPersistedSnapshots();

      /*
       * If the round is still active, restart
       * the live graph animation and 3-second
       * snapshot process.
       */
      var duration =
        Number(
          this.config.durationSeconds
        );

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        return null;
      }

      var elapsed =
        this.elapsed();

      if (elapsed >= duration) {
        this.render();
        return sessionData;
      }

      this.startLoop();

      this.render();

      return sessionData;

    } catch (error) {

      console.error(
        "Economy existing-session resume error:",
        error
      );

      return null;
    }
  };

  /*
   * Run the live economy animation.
   */
  DrissnowCreditEconomy.prototype.startLoop =
    function() {
      var self = this;

      this.stopLoops();

      this.running = true;

      var draw =
        function() {
          if (
            !self.running ||
            !self.startedAt
          ) {
            return;
          }

          var elapsed =
            self.elapsed();

          self.units =
            self.amount(
              elapsed
            ) +
            self.scoreAtLastSnapshot;

          self.render();

          var duration =
            Number(
              self.config.durationSeconds
            );

          if (
            !isFinite(duration) ||
            duration <= 0
          ) {
            self.running = false;

            self.stopAnimation();

            return;
          }

          if (
            elapsed < duration
          ) {
            self.animationFrameId =
              window.requestAnimationFrame(
                draw
              );
          } else {
            /*
             * Draw the exact final point at the database duration.
             */
            self.plotSnapshot();

            self.units =
              self.amount(
                duration
              ) +
              self.currentScore();

            self.render();

            self.animationFrameId =
              null;

            self.running = false;
          }
        };

      if (
        window.requestAnimationFrame
      ) {
        this.animationFrameId =
          window.requestAnimationFrame(
            draw
          );
      } else {
        this.timer =
          setInterval(
            function() {
              if (!self.running) {
                return;
              }

              var elapsed =
                self.elapsed();

              self.units =
                self.amount(
                  elapsed
                ) +
                self.scoreAtLastSnapshot;

              self.render();

              var duration =
                Number(
                  self.config.durationSeconds
                );

              if (
                !isFinite(duration) ||
                duration <= 0
              ) {
                self.running = false;

                self.stopAnimation();

                return;
              }

              if (
                elapsed >= duration
              ) {
                self.plotSnapshot();

                self.units =
                  self.amount(
                    duration
                  ) +
                  self.currentScore();

                self.render();

                self.running = false;

                self.stopAnimation();
              }
            },
            100
          );
      }

      var interval =
        Number(
          this.config.plotIntervalSeconds
        );

      if (
        !isFinite(interval) ||
        interval <= 0
      ) {
        interval = 3;
      }

      this.snapshotTimer =
        setInterval(
          function() {
            if (!self.running) {
              return;
            }

            var elapsed =
              self.elapsed();

            var duration =
              Number(
                self.config.durationSeconds
              );

            if (
              !isFinite(duration) ||
              duration <= 0
            ) {
              return;
            }

            if (
              elapsed >= duration
            ) {
              self.plotSnapshot();

              self.render();

              return;
            }

            self.plotSnapshot();

            self.snapshot();
          },
          interval * 1000
        );
    };

  /*
   * Stop animation frame / fallback timer.
   */
  DrissnowCreditEconomy.prototype.stopAnimation =
    function() {
      if (
        this.animationFrameId !==
          null &&
        window.cancelAnimationFrame
      ) {
        window.cancelAnimationFrame(
          this.animationFrameId
        );

        this.animationFrameId =
          null;
      }

      if (this.timer) {
        clearInterval(
          this.timer
        );

        this.timer = null;
      }
    };

  /*
   * Stop all economy loops.
   */
  DrissnowCreditEconomy.prototype.stopLoops =
    function() {
      this.running = false;

      this.stopAnimation();

      if (this.snapshotTimer) {
        clearInterval(
          this.snapshotTimer
        );

        this.snapshotTimer = null;
      }
    };

  /*
   * Add a local chart point at the configured database interval.
   */
  DrissnowCreditEconomy.prototype.plotSnapshot =
    function() {
      var interval =
        Number(
          this.config.plotIntervalSeconds
        );

      if (
        !isFinite(interval) ||
        interval <= 0
      ) {
        interval = 3;
      }

      var duration =
        Number(
          this.config.durationSeconds
        );

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        return;
      }

      var elapsed =
        this.elapsed();

      var slot =
        Math.floor(
          elapsed / interval
        ) *
        interval;

      if (
        elapsed >= duration
      ) {
        slot = duration;
      }

      slot =
        Math.min(
          duration,
          Math.max(
            0,
            slot
          )
        );

      if (
        slot ===
        this.lastSnapshotSlot
      ) {
        this.units =
          this.amount(slot) +
          this.scoreAtLastSnapshot;

        this.render();

        return;
      }

     var compoundAmount =
  this.amount(slot);

var score =
  this.currentScore();

var scoreContribution =
  score / 3;

var total =
  compoundAmount +
  scoreContribution;

this.scoreAtLastSnapshot =
  scoreContribution;

      this.units =
        total;

      this.lastSnapshotSlot =
        slot;

      this.points.push({
        seconds:
          slot,

        amount:
          total,

        compoundAmount:
          compoundAmount,

        score:
          score
      });

      this.points.sort(
        function(a, b) {
          return (
            a.seconds -
            b.seconds
          );
        }
      );

      this.render();
    };

  /*
   * Persist the current snapshot to MariaDB.
   */
  DrissnowCreditEconomy.prototype.snapshot =
    async function() {
      if (!this.sessionId) {
        return null;
      }

      var score =
        this.currentScore();

      try {
        var data =
          await this.apiRequest(
            "/economy/snapshot",
            "POST",
            {
              sessionId:
                this.sessionId,

              score:
                score
            }
          );

        if (
          data &&
          data.snapshot
        ) {
          var snapshot =
            data.snapshot;

          var serverScore =
            Number(
              snapshot.score
            );

          if (
            !isFinite(
              serverScore
            )
          ) {
            serverScore =
              score;
          }

          this.scoreAtLastSnapshot =
            Math.max(
              0,
              serverScore
            );

          var serverAmount =
            Number(
              snapshot.amount
            );

          var serverCompound =
            Number(
              snapshot.compoundAmount !==
              undefined
                ? snapshot.compoundAmount
                : snapshot.compound_amount
            );

          this.units =
            isFinite(
              serverAmount
            )
              ? serverAmount
              : (
                  isFinite(
                    serverCompound
                  )
                    ? serverCompound
                    : 0
                ) +
                this.scoreAtLastSnapshot;

          var slot =
            Number(
              snapshot.elapsedSeconds !==
              undefined
                ? snapshot.elapsedSeconds
                : snapshot.elapsed_seconds
            );

          if (
            isFinite(slot)
          ) {
            var point = {
              seconds:
                slot,

              amount:
                this.units,

              compoundAmount:
                isFinite(
                  serverCompound
                )
                  ? serverCompound
                  : Math.max(
                      0,
                      this.units -
                      this.scoreAtLastSnapshot
                    ),

              score:
                this.scoreAtLastSnapshot
            };

            var replaced =
              false;

            for (
              var i = 0;
              i < this.points.length;
              i++
            ) {
              if (
                this.points[i].seconds ===
                slot
              ) {
                this.points[i] =
                  point;

                replaced = true;

                break;
              }
            }

            if (!replaced) {
              this.points.push(
                point
              );
            }

            this.points.sort(
              function(a, b) {
                return (
                  a.seconds -
                  b.seconds
                );
              }
            );
          }

          this.render();
        }

        return data;
      } catch (error) {
        console.error(
          "Economy snapshot error:",
          error
        );

        return null;
      }
    };

  /*
   * Refresh final session state from the server.
   */
  DrissnowCreditEconomy.prototype.refreshFinalState =
    async function() {
      if (!this.sessionId) {
        return null;
      }

      try {
        var data =
          await this.apiRequest(
            "/economy/session",
            "POST",
            {
              sessionId:
                this.sessionId
            }
          );

        if (
          data &&
          data.session
        ) {
          var session =
            data.session;

          if (
            session.finalBalance !==
            undefined
          ) {
            var finalBalance =
              Number(
                session.finalBalance
              );

            if (
              isFinite(
                finalBalance
              )
            ) {
              this.units =
                finalBalance;
            }
          }

          if (
            session.status ===
            "settled"
          ) {
            this.running =
              false;
          }
        }

        this.render();

        return data;
      } catch (error) {
        return null;
      }
    };

  /*
   * Settle the current economy session.
   */
  DrissnowCreditEconomy.prototype.settle =
    async function() {
      this.stopLoops();

      var finalScore =
        this.currentScore();

      var duration =
        Number(
          this.config.durationSeconds
        );

      /*
       * Do not calculate a fake final amount if the database
       * configuration has not loaded.
       */
      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        return {
          success: false,
          message:
            "Economy duration is unavailable"
        };
      }

      var compoundAmount =
        this.amount(duration);

      var finalScore =
  this.currentScore();

var finalScoreContribution =
  finalScore / 3;

var localFinalAmount =
  compoundAmount +
  finalScoreContribution;

this.scoreAtLastSnapshot =
  finalScoreContribution;

      this.units =
        localFinalAmount;

      var finalPoint = {
        seconds:
          duration,

        amount:
          localFinalAmount,

        compoundAmount:
          compoundAmount,

      score:
  finalScoreContribution
      };

      var replaced =
        false;

      for (
        var i = 0;
        i < this.points.length;
        i++
      ) {
        if (
          this.points[i].seconds ===
          duration
        ) {
          this.points[i] =
            finalPoint;

          replaced = true;

          break;
        }
      }

      if (!replaced) {
        this.points.push(
          finalPoint
        );
      }

      this.points.sort(
        function(a, b) {
          return (
            a.seconds -
            b.seconds
          );
        }
      );

      try {
        if (this.sessionId) {
          var data =
            await this.apiRequest(
              "/economy/settle",
              "POST",
              {
                sessionId:
                  this.sessionId,

                score:
                  finalScore
              }
            );

          if (
            data &&
            data.success
          ) {
            var serverFinal =
              Number(
                data.finalAmount
              );

            if (
              isFinite(
                serverFinal
              )
            ) {
              this.units =
                serverFinal;
            }

            if (data.config) {
              this.applyConfig(
                data.config
              );
            }

            if (data.session) {
              this.sessionId =
                data.session.id ||
                this.sessionId;
            }

            if (
              this.finalElement
            ) {
              this.finalElement.textContent =
                this.units.toFixed(
                  6
                );
            }

            this.render();

            this.clearStoredSessionId();

            return data;
          }
        }
      } catch (error) {
        console.error(
          "Economy settle error:",
          error
        );
      }

      if (
        this.finalElement
      ) {
        this.finalElement.textContent =
          localFinalAmount.toFixed(
            6
          );
      }

      this.render();

      return {
        success: true,

        finalAmount:
          localFinalAmount,

        compoundAmount:
          compoundAmount,

        score:
          finalScore
      };
    };

  /*
   * Render live values.
   */
  DrissnowCreditEconomy.prototype.render =
    function() {
      if (
        this.unitsElement
      ) {
        this.unitsElement.textContent =
          Number(
            this.units
          ).toFixed(6);
      }

      if (
        this.scoreElement
      ) {
        this.scoreElement.textContent =
          Number(
            this.currentScore()
          ).toFixed(0);
      }

      if (
        this.countdownElement
      ) {
        if (
          this.roundEndTime
        ) {
          var remaining =
            Math.max(
              0,
              Math.ceil(
                (
                  this.roundEndTime -
                  Date.now()
                ) / 1000
              )
            );

          this.countdownElement.textContent =
            remaining +
            "s";
        } else {
          this.countdownElement.textContent =
            "--";
        }
      }

      this.drawChart();
    };

  /*
   * Draw the live chart.
   *
   * X-axis maximum is always:
   *
   *   MariaDB economy_config.duration_seconds
   */
  DrissnowCreditEconomy.prototype.drawChart =
    function() {
      if (
        !this.canvas ||
        !this.ctx
      ) {
        return;
      }

      var rect =
        this.canvas.getBoundingClientRect();

      var width =
        rect.width || 300;

      var height =
        rect.height || 180;

      this.ctx.clearRect(
        0,
        0,
        width,
        height
      );

      /*
       * IMPORTANT:
       *
       * This is the only duration used by the chart.
       * It came from MariaDB through /economy/config
       * or the database session response.
       */
      var duration =
        Number(
          this.config.durationSeconds
        );

      if (
        !isFinite(duration) ||
        duration <= 0
      ) {
        return;
      }

      var samples =
        this.points.slice();

      var elapsed =
        this.elapsed();

      /*
       * Add current live point temporarily.
       */
      if (this.startedAt) {
        var liveSeconds =
          Math.max(
            0,
            Math.min(
              duration,
              elapsed
            )
          );

        samples.push({
          seconds:
            liveSeconds,

          amount:
            this.amount(
              liveSeconds
            ) +
            this.scoreAtLastSnapshot
        });
      }

      if (!samples.length) {
        return;
      }

      /*
       * Determine Y-axis maximum.
       */
      var max = 0;

      samples.forEach(
        function(point) {
          max =
            Math.max(
              max,
              Number(
                point.amount
              ) || 0
            );
        }
      );

      max =
        Math.max(
          max,
          Number(
            this.units
          ) || 0,
          Number(
            this.config.initialBalance
          ) || 0
        );

      if (max <= 0) {
        max = 1;
      }

      var paddingLeft = 48;
      var paddingRight = 12;
      var paddingTop = 12;
      var paddingBottom = 30;

      var plotWidth =
        Math.max(
          1,
          width -
          paddingLeft -
          paddingRight
        );

      var plotHeight =
        Math.max(
          1,
          height -
          paddingTop -
          paddingBottom
        );

      var ctx =
        this.ctx;

      ctx.save();

      ctx.lineWidth = 1;

      /*
       * Y-axis grid, ticks and labels.
       */
      var yTicks = 5;

      for (
        var yTick = 0;
        yTick <= yTicks;
        yTick++
      ) {
        var yValue =
          (
            max /
            yTicks
          ) *
          yTick;

        var y =
          height -
          paddingBottom -
          (
            yValue /
            max
          ) *
          plotHeight;

        ctx.beginPath();

        ctx.moveTo(
          paddingLeft,
          y
        );

        ctx.lineTo(
          width -
          paddingRight,
          y
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
          paddingLeft - 4,
          y
        );

        ctx.lineTo(
          paddingLeft,
          y
        );

        ctx.stroke();

        ctx.textAlign =
          "right";

        ctx.textBaseline =
          "middle";

        ctx.font =
          "10px Arial, Helvetica, sans-serif";

        ctx.fillText(
          yValue.toFixed(1),
          paddingLeft - 7,
          y
        );
      }

      /*
       * X-axis scale.
       *
       * The chart always spans the full database duration.
       *
       * Tick spacing uses a human-friendly
       * 1 / 2 / 5 * 10^n step.
       */
      var targetXTicks = 6;

      var rawStep =
        duration /
        targetXTicks;

      var magnitude =
        Math.pow(
          10,
          Math.floor(
            Math.log(
              rawStep
            ) /
            Math.LN10
          )
        );

      var normalized =
        rawStep /
        magnitude;

      var niceMultiplier;

      if (
        normalized <= 1
      ) {
        niceMultiplier = 1;
      } else if (
        normalized <= 2
      ) {
        niceMultiplier = 2;
      } else if (
        normalized <= 5
      ) {
        niceMultiplier = 5;
      } else {
        niceMultiplier = 10;
      }

      var xTickStep =
        niceMultiplier *
        magnitude;

      if (
        !isFinite(
          xTickStep
        ) ||
        xTickStep <= 0
      ) {
        xTickStep =
          duration;
      }

      var xTicks =
        Math.max(
          1,
          Math.ceil(
            duration /
            xTickStep
          )
        );

      for (
        var xTick = 0;
        xTick <= xTicks;
        xTick++
      ) {
        var seconds =
          Math.min(
            duration,
            xTick *
            xTickStep
          );

        /*
         * Always include the exact database duration
         * as the final X-axis label.
         */
        if (
          xTick === xTicks
        ) {
          seconds =
            duration;
        }

        var x =
          paddingLeft +
          (
            seconds /
            duration
          ) *
          plotWidth;

        ctx.beginPath();

        ctx.moveTo(
          x,
          paddingTop
        );

        ctx.lineTo(
          x,
          height -
          paddingBottom
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.moveTo(
          x,
          height -
          paddingBottom
        );

        ctx.lineTo(
          x,
          height -
          paddingBottom +
          4
        );

        ctx.stroke();

        ctx.textAlign =
          "center";

        ctx.textBaseline =
          "top";

        ctx.font =
          "10px Arial, Helvetica, sans-serif";

        ctx.fillText(
          Math.round(
            seconds
          ) +
          "s",
          x,
          height -
          paddingBottom +
          7
        );
      }

      /*
       * Main axes.
       */
      ctx.beginPath();

      ctx.moveTo(
        paddingLeft,
        paddingTop
      );

      ctx.lineTo(
        paddingLeft,
        height -
        paddingBottom
      );

      ctx.stroke();

      ctx.beginPath();

      ctx.moveTo(
        paddingLeft,
        height -
        paddingBottom
      );

      ctx.lineTo(
        width -
        paddingRight,
        height -
        paddingBottom
      );

      ctx.stroke();

      /*
       * X-axis title.
       */
      ctx.textAlign =
        "center";

      ctx.textBaseline =
        "bottom";

      ctx.font =
        "bold 10px Arial, Helvetica, sans-serif";

      ctx.fillText(
        "Time",
        paddingLeft +
        plotWidth / 2,
        height - 2
      );

      /*
       * Y-axis title.
       */
      ctx.save();

      ctx.translate(
        11,
        paddingTop +
        plotHeight / 2
      );

      ctx.rotate(
        -Math.PI / 2
      );

      ctx.textAlign =
        "center";

      ctx.textBaseline =
        "middle";

      ctx.font =
        "bold 10px Arial, Helvetica, sans-serif";

      ctx.fillText(
        "Peanut Units",
        0,
        0
      );

      ctx.restore();

      /*
       * Economy line.
       */
      ctx.beginPath();

      samples.forEach(
        function(
          point,
          index
        ) {
          var seconds =
            Math.max(
              0,
              Math.min(
                duration,
                Number(
                  point.seconds
                ) || 0
              )
            );

          var amount =
            Math.max(
              0,
              Number(
                point.amount
              ) || 0
            );

          var x =
            paddingLeft +
            (
              seconds /
              duration
            ) *
            plotWidth;

          var y =
            height -
            paddingBottom -
            (
              amount /
              max
            ) *
            plotHeight;

          if (
            index === 0
          ) {
            ctx.moveTo(
              x,
              y
            );
          } else {
            ctx.lineTo(
              x,
              y
            );
          }
        }
      );

      ctx.stroke();

      /*
       * Current live position.
       */
      if (
        this.startedAt
      ) {
        var currentSeconds =
          Math.max(
            0,
            Math.min(
              duration,
              elapsed
            )
          );

        var currentAmount =
          this.amount(
            currentSeconds
          ) +
          this.currentScore();

        

        var cx =
          paddingLeft +
          (
            currentSeconds /
            duration
          ) *
          plotWidth;

        var cy =
          height -
          paddingBottom -
          (
            currentAmount /
            max
          ) *
          plotHeight;

        ctx.beginPath();

        ctx.arc(
          cx,
          cy,
          3,
          0,
          Math.PI * 2
        );

        ctx.fill();
      }

      ctx.restore();
    };

  /*
   * Expose the economy module globally for the classic
   * browser-script architecture.
   */
  window.DrissnowCreditEconomy =
    DrissnowCreditEconomy;

})(window);
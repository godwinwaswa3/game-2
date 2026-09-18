function GameManager(size, InputManager, Actuator, StorageManager, CreditsManager) {
  this.size           = size; // Size of the grid
  this.inputManager   = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator       = new Actuator;
  this.creditsManager = new CreditsManager;

  var data = window.DrissnowAppData || {};
  var config = data.game || {};
  var scoreConfig = config.scoreCredits || {};

  this.startTiles = Number(config.startTiles) || 2;

  // Round duration is controlled by MariaDB economy_config.duration_seconds.
  // This legacy value is kept only as an emergency fallback if the API
  // cannot be reached; it never overrides a value returned by MariaDB.
  this.defaultRoundSeconds = Number(config.defaultRoundSeconds) || 90;
  this.roundActive         = false;

  // Absolute timestamp (ms) the current round ends at. Persisted to
  // localStorage as part of the game state, so a page refresh can
  // recompute real remaining time instead of resetting the clock.
  this.roundEndTime = null;

  // Tile value -> base bonus credits. This is the single source of
  // truth for milestone amounts; CreditsManager just books the credit
  // and handles the "already won this one?" + surprise-doubling logic.
  this.milestones = Object.assign({}, config.milestones || {});

  // Score -> credits conversion, capped so it stays proportional to
  // real gameplay and can never run away.
  this.scoreCreditRate = Number(scoreConfig.rate) || 300;
  this.maxScoreCredits = Number(scoreConfig.maxPerRound) || 25;

  this.timerHandle       = null;
  this.timeRemaining     = 0;
  this.scoreBonusSettled = false;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));

  this.setup();
}

GameManager.prototype.stopTimer = function () {
  if (this.timerHandle) {
    clearInterval(this.timerHandle);
    this.timerHandle = null;
  }
};

// Fetch the round duration from the economy configuration in MariaDB.
//
// The economy module already knows how to communicate with the API, so
// GameManager deliberately does not maintain a second duration setting.
GameManager.prototype.getDatabaseRoundDuration = async function () {
  try {
    if (window.drissnowFeatures &&
        window.drissnowFeatures.creditEconomy &&
        window.drissnowFeatures.creditEconomy.loadConfig) {

      var config =
        await window.drissnowFeatures.creditEconomy.loadConfig();

      var duration =
        Number(config && config.durationSeconds);

      if (isFinite(duration) && duration > 0) {
        return Math.round(duration);
      }
    }
  } catch (err) {
    console.error(
      "Economy duration config error:",
      err
    );
  }

  // Emergency-only fallback if the API is temporarily unavailable.
  // This is never used when MariaDB is reachable and never overrides
  // the database value.
  return this.defaultRoundSeconds;
};

// Starts (or resumes) the countdown.
//
// For a new round, duration comes exclusively from MariaDB
// economy_config.duration_seconds.
//
// For a resumed round, the previously persisted absolute end timestamp
// is retained so refreshing the page cannot reset the timer.
// -------------------------------------------------
// Start / resume the 2048 round timer.
//
// durationOverride is supplied by a successfully
// redeemed code.
//
// Priority:
//   1. Existing absolute end time when RESUMING
//   2. Code duration when starting a fresh round
//   3. economy_config.duration_seconds
//   4. defaultRoundSeconds emergency fallback
// -------------------------------------------------
GameManager.prototype.startTimer = async function (
  resumeEndTime,
  durationOverride
) {
  var self = this;

  this.stopTimer();

  /*
   * RESUME:
   *
   * Never replace an already-running round's absolute
   * end time. This prevents a page refresh from creating
   * a fresh duration.
   */
  if (resumeEndTime) {

    this.roundEndTime = resumeEndTime;

    this.roundDurationSeconds =
      Math.max(
        1,
        Math.round(
          (
            resumeEndTime -
            Date.now()
          ) / 1000
        )
      );

  } else {

    /*
     * FRESH ROUND:
     *
     * A valid duration supplied by the redemption code
     * takes priority over economy_config.
     */
    var chosen =
      Number(durationOverride);

    if (
      !isFinite(chosen) ||
      chosen <= 0
    ) {
      /*
       * No code duration.
       *
       * Fall back to the database economy configuration.
       */
      chosen =
        await this.getDatabaseRoundDuration();
    }

    if (
      !isFinite(chosen) ||
      chosen <= 0
    ) {
      chosen =
        this.defaultRoundSeconds;
    }

    chosen =
      Math.max(
        1,
        Math.round(chosen)
      );

    this.roundDurationSeconds =
      chosen;

    this.roundEndTime =
      Date.now() +
      chosen * 1000;
  }

  this.roundActive = true;

  this.actuator.setTimerInputEnabled(false);

  /*
   * Tell FeatureManager the EXACT duration used by
   * this 2048 round.
   *
   * The economy chart receives the same value.
   */
  if (
    window.drissnowFeatures &&
    window.drissnowFeatures.creditEconomyStart
  ) {

    await window.drissnowFeatures.creditEconomyStart(
      !!resumeEndTime,
      this.roundDurationSeconds
    );
  }

  /*
   * Update the 2048 timer immediately.
   */
  this.tick();

  this.timerHandle =
    setInterval(
      function () {
        self.tick();
      },
      1000
    );
};

// -------------------------------------------------
// Start a completely fresh 2048 round using the
// duration contained in a successfully redeemed code.
//
// The redeemed code has already added the credit.
// This method consumes one credit to start the game,
// exactly like the normal setup/start flow.
// -------------------------------------------------
GameManager.prototype.startRedeemedRound = async function (
  durationSeconds
) {
  var duration =
    Number(durationSeconds);

  if (
    !isFinite(duration) ||
    duration <= 0
  ) {
    console.warn(
      "Invalid redeemed-code duration:",
      durationSeconds
    );

    /*
     * No valid code duration.
     * Preserve the normal database/default behavior.
     */
    return this.setup();
  }

  duration =
    Math.max(
      1,
      Math.round(duration)
    );

  /*
   * A redeemed code starts a NEW round.
   *
   * Do not resume the previous board because that would
   * retain the old round's timer.
   */
  this.stopTimer();

  this.storageManager.clearGameState();

  this.actuator.hideGameOver();

  this.grid =
    new Grid(this.size);

  this.score = 0;

  this.over = false;

  this.won = false;

  this.scoreBonusSettled = false;

  /*
   * The redemption itself added the credit.
   * Starting the actual game consumes that credit.
   */
  var hasCredits =
    await this.creditsManager.hasCredits();

  if (!hasCredits) {
    this.actuator.noCredits();
    return;
  }

  await this.creditsManager.useCredit();

  this.addStartTiles();

  /*
   * THIS is where the intrinsic code duration enters
   * the 2048 timer.
   */
  await this.startTimer(
    null,
    duration
  );

  this.actuate();

  /*
   * Keep the actual duration visible in the game
   * object's state for debugging and persistence.
   */
  this.roundDurationSeconds =
    duration;

  console.log(
    "[DrissNow] Redeemed code duration applied:",
    duration,
    "seconds"
  );
};
// Recomputes remaining time from the real clock
// (roundEndTime - now) rather than decrementing a counter,
// so it reflects real elapsed time even across a page reload,
// backgrounding, or tab throttling.
GameManager.prototype.tick = function () {
  var remaining =
    Math.max(
      0,
      Math.round(
        (this.roundEndTime - Date.now()) / 1000
      )
    );

  this.timeRemaining = remaining;

  this.actuator.updateTimer(remaining);

  if (remaining <= 0) {
    this.stopTimer();
    this.endGame("Time's up!");
  }
};

// Ends the current round (either reason) and settles the
// score-based credit bonus exactly once.
GameManager.prototype.endGame = function (reason) {
  this.over        = true;
  this.roundActive = false;

  this.stopTimer();

  this.actuator.setTimerInputEnabled(true);

  this.settleScoreCredits();

  this.actuator.setGameOverReason(reason);

  this.actuate();
};

GameManager.prototype.settleScoreCredits = async function () {
  if (this.scoreBonusSettled) return;

  this.scoreBonusSettled = true;

  try {
    var result =
      await this.creditsManager.settleScoreBonus(
        this.score,
        this.scoreCreditRate,
        this.maxScoreCredits
      );

    if (result.bonus > 0) {
      this.actuator.updateCredits(
        result.credits
      );

      this.actuator.showPrizeToast(
        null,
        result.bonus,
        "Score bonus! "
      );
    }
  } catch (err) {
    console.error(
      "Score bonus error:",
      err
    );
  }

  // Let the economy module settle its database session too.
  if (
    window.drissnowFeatures &&
    window.drissnowFeatures.creditEconomySettle
  ) {
    window.drissnowFeatures.creditEconomySettle()
      .catch(function (err) {
        console.error(
          "Economy settlement error:",
          err
        );
      });
  }
};

// Restart the game (gated behind having a credit).
// The RESTART button and the 'R' key are the only restart entries.
GameManager.prototype.restart = async function () {
  try {
    var hasCredits =
      await this.creditsManager.hasCredits();

    if (!hasCredits) {
      this.actuator.hideGameOver();
      this.actuator.noCredits();
      return;
    }

    await this.creditsManager.useCredit();

    this.storageManager.clearGameState();

    this.actuator.hideGameOver();

    this.grid =
      new Grid(this.size);

    this.score = 0;

    this.over = false;

    this.scoreBonusSettled = false;

    this.addStartTiles();

    // New round duration comes from MariaDB.
    await this.startTimer();

    this.actuate();

  } catch (err) {
    console.error(
      "Credits error in restart:",
      err
    );

    this.actuator.noCredits();
  }
};

GameManager.prototype.isGameTerminated = function () {
  return this.over;
};

GameManager.prototype.setup = async function () {
  var previousState =
    this.storageManager.getGameState();

  if (
    previousState &&
    !previousState.over
  ) {
    this.grid =
      new Grid(
        previousState.grid.size,
        previousState.grid.cells
      );

    this.score =
      previousState.score;

    this.over = false;

    this.scoreBonusSettled = false;

    // Figure out how much real time is actually left,
    // based on the absolute end timestamp we saved.
    var remaining =
      previousState.roundEndTime
        ? Math.max(
            0,
            Math.round(
              (previousState.roundEndTime -
                Date.now()) /
                1000
            )
          )
        : 0;

    if (remaining <= 0) {
      // Time ran out while the page was closed,
      // refreshed, or backgrounded.
      this.endGame("Time's up!");
    } else {
      // Resume the existing timestamp.
      await this.startTimer(
        previousState.roundEndTime
      );

      this.actuate();
    }

    return;
  }

  this.storageManager.clearGameState();

  this.grid =
    new Grid(this.size);

  this.score = 0;

  this.over = false;

  this.scoreBonusSettled = false;

  this.roundEndTime = null;

  try {
    var hasCredits =
      await this.creditsManager.hasCredits();

    this.actuator.updateCredits(
      await this.creditsManager.getCredits()
    );

    if (!hasCredits) {
      this.actuator.noCredits();

      this.actuator.setTimerInputEnabled(true);

      this.actuator.actuate(
        this.grid,
        {
          score: 0,
          over: false,
          bestScore:
            this.storageManager.getBestScore(),
          terminated: false
        }
      );

      return;
    }

    await this.creditsManager.useCredit();

    this.addStartTiles();

    // Fetch MariaDB duration before creating the round timestamp.
    await this.startTimer();

    this.actuate();

  } catch (err) {
    console.error(
      "Credits error in setup:",
      err
    );

    this.actuator.noCredits();
  }
};

GameManager.prototype.addStartTiles = function () {
  for (
    var i = 0;
    i < this.startTiles;
    i++
  ) {
    this.addRandomTile();
  }
};

GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value =
      Math.random() < 0.9
        ? 2
        : 4;

    var tile =
      new Tile(
        this.grid.randomAvailableCell(),
        value
      );

    this.grid.insertTile(tile);
  }
};

GameManager.prototype.actuate = function () {
  if (
    this.storageManager.getBestScore() <
    this.score
  ) {
    this.storageManager.setBestScore(
      this.score
    );
  }

  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(
      this.serialize()
    );
  }

  this.actuator.hideNoCredits();

  // Credits are updated asynchronously elsewhere too;
  // this keeps the display in sync as a best-effort catch-all.
  this.creditsManager.getCredits()
    .then(function (credits) {
      this.actuator.updateCredits(
        credits
      );
    }.bind(this))
    .catch(function () {});

  this.actuator.actuate(
    this.grid,
    {
      score: this.score,
      over: this.over,
      bestScore:
        this.storageManager.getBestScore(),
      terminated:
        this.isGameTerminated()
    }
  );
};

// Includes roundEndTime so a refresh can recompute real time left
// instead of resetting the clock to the full duration.
GameManager.prototype.serialize = function () {
  return {
    grid:
      this.grid.serialize(),

    score:
      this.score,

    over:
      this.over,

    roundEndTime:
      this.roundEndTime
  };
};

GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(
    function (x, y, tile) {
      if (tile) {
        tile.mergedFrom = null;
        tile.savePosition();
      }
    }
  );
};

GameManager.prototype.moveTile = function (
  tile,
  cell
) {
  this.grid.cells[tile.x][tile.y] = null;

  this.grid.cells[cell.x][cell.y] = tile;

  tile.updatePosition(cell);
};

// Award credits immediately and show a quick,
// non-blocking toast.
GameManager.prototype.checkMilestone =
  async function (value) {

    var baseBonus =
      this.milestones[value];

    if (!baseBonus) return;

    try {
      var result =
        await this.creditsManager.recordMilestone(
          value,
          baseBonus
        );

      if (
        result.firstTime &&
        result.bonus > 0
      ) {
        this.actuator.updateCredits(
          result.credits
        );

        this.actuator.showPrizeToast(
          value,
          result.bonus,
          result.bonus > baseBonus
            ? "Surprise! "
            : ""
        );
      }
    } catch (err) {
      console.error(
        "Milestone error:",
        err
      );
    }

    // Keep the economy feature informed too.
    if (
      window.drissnowFeatures &&
      window.drissnowFeatures.creditEconomyMilestone
    ) {
      window.drissnowFeatures.creditEconomyMilestone(
        value,
        baseBonus
      );
    }
  };

GameManager.prototype.move = function (
  direction
) {
  var self = this;

  if (this.isGameTerminated()) return;

  var cell, tile;

  var vector =
    this.getVector(direction);

  var traversals =
    this.buildTraversals(vector);

  var moved = false;

  this.prepareTiles();

  traversals.x.forEach(
    function (x) {
      traversals.y.forEach(
        function (y) {

          cell = {
            x: x,
            y: y
          };

          tile =
            self.grid.cellContent(cell);

          if (tile) {
            var positions =
              self.findFarthestPosition(
                cell,
                vector
              );

            var next =
              self.grid.cellContent(
                positions.next
              );

            if (
              next &&
              next.value === tile.value &&
              !next.mergedFrom
            ) {
              var merged =
                new Tile(
                  positions.next,
                  tile.value * 2
                );

              merged.mergedFrom = [
                tile,
                next
              ];

              self.grid.insertTile(
                merged
              );

              self.grid.removeTile(
                tile
              );

              tile.updatePosition(
                positions.next
              );

              self.score +=
                merged.value;

              self.checkMilestone(
                merged.value
              );

            } else {
              self.moveTile(
                tile,
                positions.farthest
              );
            }

            if (
              !self.positionsEqual(
                cell,
                tile
              )
            ) {
              moved = true;
            }
          }
        }
      );
    }
  );

  if (moved) {
    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.endGame(
        "No more moves!"
      );

      return;
    }

    this.actuate();
  }
};

GameManager.prototype.getVector =
  function (direction) {
    var map = {
      0: {
        x: 0,
        y: -1
      },
      1: {
        x: 1,
        y: 0
      },
      2: {
        x: 0,
        y: 1
      },
      3: {
        x: -1,
        y: 0
      }
    };

    return map[direction];
  };

GameManager.prototype.buildTraversals =
  function (vector) {

    var traversals = {
      x: [],
      y: []
    };

    for (
      var pos = 0;
      pos < this.size;
      pos++
    ) {
      traversals.x.push(pos);
      traversals.y.push(pos);
    }

    if (vector.x === 1) {
      traversals.x =
        traversals.x.reverse();
    }

    if (vector.y === 1) {
      traversals.y =
        traversals.y.reverse();
    }

    return traversals;
  };

GameManager.prototype.findFarthestPosition =
  function (cell, vector) {

    var previous;

    do {
      previous = cell;

      cell = {
        x: previous.x + vector.x,
        y: previous.y + vector.y
      };

    } while (
      this.grid.withinBounds(cell) &&
      this.grid.cellAvailable(cell)
    );

    return {
      farthest: previous,
      next: cell
    };
  };

GameManager.prototype.movesAvailable =
  function () {
    return (
      this.grid.cellsAvailable() ||
      this.tileMatchesAvailable()
    );
  };

GameManager.prototype.tileMatchesAvailable =
  function () {

    var self = this;

    var tile;

    for (
      var x = 0;
      x < this.size;
      x++
    ) {
      for (
        var y = 0;
        y < this.size;
        y++
      ) {
        tile =
          this.grid.cellContent({
            x: x,
            y: y
          });

        if (tile) {
          for (
            var direction = 0;
            direction < 4;
            direction++
          ) {
            var vector =
              self.getVector(
                direction
              );

            var cell = {
              x: x + vector.x,
              y: y + vector.y
            };

            var other =
              self.grid.cellContent(
                cell
              );

            if (
              other &&
              other.value === tile.value
            ) {
              return true;
            }
          }
        }
      }
    }

    return false;
  };

GameManager.prototype.positionsEqual =
  function (first, second) {
    return (
      first.x === second.x &&
      first.y === second.y
    );
  };
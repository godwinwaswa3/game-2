(function(window) {
  "use strict";

  function FeatureManager(game) {
    this.game = game;

    this.data = window.DrissnowAppData || {};
    this.featureConfig = this.data.features || {};
    this.playerDefaults = this.data.playerDefaults || {};

    this.creditEconomy =
      new window.DrissnowCreditEconomy();

    this.creditEconomy.gameScoreProvider =
      function() {
        return Number(game.score) || 0;
      };

    this.creditEconomy.mount();

    this.key = "drissnowFeatures";

    this.state = Object.assign({}, this.playerDefaults, this.load());
    this.history = [];

    this.combo = 0;
    this.comboTimer = null;

    this.doubleScore = false;
    this.doubleScoreTimer = null;

    this.paused = false;
    this.syncing = false;

    this.powerups = Object.assign({}, this.featureConfig.powerups || {});

    this.achievements = {};
    this.challenge = this.makeDailyChallenge();

    this.themes = {};
    (this.featureConfig.themes || []).forEach(function(theme) {
      this.themes[theme] = theme;
    }, this);

    this.theme =
      this.state.theme ||
      this.featureConfig.defaultTheme ||
      "classic";

    this.ensureProgress();
    this.installUI();
    this.installHooks();
    this.applyTheme(this.theme);
    this.render();

    this.loadServerStats();

this.restoreEconomy();
  }

  FeatureManager.prototype.load = function() {
    try {
      var raw =
        localStorage.getItem(this.key);

      if (!raw) {
        return {};
      }

      return JSON.parse(raw) || {};
    } catch (error) {
      console.error(
        "Unable to load feature state:",
        error
      );

      return {};
    }
  };

  FeatureManager.prototype.save = function() {
    try {
      localStorage.setItem(
        this.key,
        JSON.stringify(this.state)
      );
    } catch (error) {
      console.error(
        "Unable to save feature state:",
        error
      );
    }
  };

  FeatureManager.prototype.ensureProgress = function() {
    if (!this.state.xp) {
      this.state.xp = 0;
    }

    if (!this.state.level) {
      this.state.level = 1;
    }

    if (!this.state.gamesPlayed) {
      this.state.gamesPlayed = 0;
    }

    if (!this.state.gamesWon) {
      this.state.gamesWon = 0;
    }

    if (!this.state.highScore) {
      this.state.highScore = 0;
    }

    if (!this.state.bestCombo) {
      this.state.bestCombo = 0;
    }

    if (!this.state.totalMoves) {
      this.state.totalMoves = 0;
    }

    if (!this.state.achievements) {
      this.state.achievements = {};
    }

    if (!this.state.theme) {
      this.state.theme = this.featureConfig.defaultTheme || "classic";
    }

    this.save();
  };

  FeatureManager.prototype.apiRequest = async function(
    path,
    method,
    body
  ) {
    var playerId = null;

    if (this.game.creditsManager &&
        this.game.creditsManager.playerId) {
      playerId =
        this.game.creditsManager.playerId;
    }

    var response = await fetch(
      "http://localhost:3001/curl",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: "/game" + path,
          method: method || "GET",
          playerId: playerId,
          body: body || {}
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        "Feature API request failed"
      );
    }

    return response.json();
  };

  /*
   * Economy
   *
   * The economy module is intentionally kept
   * outside FeatureManager.
   */
FeatureManager.prototype.startEconomyWhenReady =
  async function(
    roundEndTime,
    durationSeconds,
    isResume
  ) {
      var self = this;

      try {
        var id =
          localStorage.getItem(
            "drissnowEconomyPlayerId"
          );

        if (!id) {
          if (this.game.creditsManager &&
              this.game.creditsManager.playerId) {
            id =
              this.game.creditsManager.playerId;
          }
        }

        if (!id) {
          id =
            "economy-" +
            Math.random()
              .toString(36)
              .slice(2) +
            "-" +
            Date.now();
        }

        localStorage.setItem(
          "drissnowEconomyPlayerId",
          id
        );

       await this.creditEconomy.start(
  id,
  roundEndTime,
  durationSeconds,
  !!isResume
);
      } catch (error) {
        console.error(
          "Economy initialization error:",
          error
        );

        if (self.creditEconomy) {
          self.creditEconomy.startedAt =
            Date.now();

          self.creditEconomy.roundEndTime =
            roundEndTime ||
            Date.now() +
            Number(durationSeconds || 30) *
            1000;

          self.creditEconomy.render();
        }
      }
    };

  FeatureManager.prototype.restoreEconomy =
  async function() {
    var self = this;

    try {
      var id =
        localStorage.getItem(
          "drissnowEconomyPlayerId"
        );

      if (!id &&
          this.game.creditsManager &&
          this.game.creditsManager.playerId) {
        id =
          this.game.creditsManager.playerId;
      }

      if (!id) {
        console.warn(
          "No economy player ID available for restoration."
        );
        return null;
      }

      localStorage.setItem(
        "drissnowEconomyPlayerId",
        id
      );

      if (!this.creditEconomy ||
          !this.creditEconomy.restoreFromServer) {
        console.warn(
          "Economy restore method is not available."
        );
        return null;
      }

      return await this.creditEconomy.restoreFromServer(
        id
      );

    } catch (error) {
      console.error(
        "Economy restoration error:",
        error
      );

      return null;
    }
  };

 FeatureManager.prototype.onGameStarted =
  async function(
    roundEndTime,
    isResume,
    durationSeconds
  ) {
    /*
     * RESUMED GAME
     *
     * First attempt to restore the existing
     * server-side economy session.
     */
    if (isResume) {
      try {
        if (this.creditEconomy &&
            this.creditEconomy.resumeExistingSession) {

          var restored =
            await this.creditEconomy.resumeExistingSession(
              roundEndTime
            );

          if (restored) {
            return;
          }
        }
      } catch (error) {
        console.error(
          "Unable to resume existing economy session:",
          error
        );
      }

      /*
       * Only create a new session if there was
       * genuinely no existing session to resume.
       */
      await this.startEconomyWhenReady(
        roundEndTime,
        durationSeconds,
        true
      );

      return;
    }

    /*
     * FRESH GAME
     *
     * A genuinely new round gets a new economy
     * session.
     */
    await this.startEconomyWhenReady(
      roundEndTime,
      durationSeconds,
      false
    );
  };

  FeatureManager.prototype.creditEconomyStart =
    function(isResume, durationSeconds) {
      return this.onGameStarted(
        this.game.roundEndTime,
        !!isResume,
        durationSeconds
      );
    };

  FeatureManager.prototype.creditEconomyTick =
    function() {
      if (!this.creditEconomy) {
        return;
      }

      this.creditEconomy.render();
    };

  FeatureManager.prototype.creditEconomyMilestone =
    function(value, bonus) {
      /*
       * Milestones remain part of the existing
       * Peanut Credits system. They do not alter
       * the non-cash economy calculation.
       */
      if (this.game.creditsManager &&
          this.game.creditsManager.recordMilestone) {
        return this.game.creditsManager.recordMilestone(
          value,
          bonus
        );
      }
    };

  FeatureManager.prototype.creditEconomySettle =
    function() {
      if (!this.creditEconomy) {
        return null;
      }

      return this.creditEconomy.settle();
    };

  /*
   * Game hooks
   */

  FeatureManager.prototype.installHooks =
    function() {
      var self = this;
      var game = this.game;

      var originalMove = game.move;

      game.move = function(direction) {
        var beforeScore =
          Number(game.score) || 0;

        var result =
          originalMove.apply(game, arguments);

        var afterScore =
          Number(game.score) || 0;

        if (afterScore !== beforeScore) {
          self.combo += 1;

          if (self.comboTimer) {
            clearTimeout(self.comboTimer);
          }

          self.comboTimer = setTimeout(
            function() {
              self.combo = 0;
            },
            2500
          );

          self.state.totalMoves += 1;

          if (self.combo >
              (self.state.bestCombo || 0)) {
            self.state.bestCombo =
              self.combo;
          }

          self.addXP(1);
          self.checkAchievements();

          self.save();
          self.render();
        }

        return result;
      };

      var originalEndGame = game.endGame;

      game.endGame = function(message) {
        var result =
          originalEndGame.apply(
            game,
            arguments
          );

        self.creditEconomySettle();

        self.state.gamesPlayed =
          Number(self.state.gamesPlayed || 0) + 1;

        if (game.over &&
            game.won) {
          self.state.gamesWon =
            Number(self.state.gamesWon || 0) + 1;
        }

        var score =
          Number(game.score) || 0;

        if (score >
            Number(self.state.highScore || 0)) {
          self.state.highScore = score;
        }

        self.checkAchievements();
        self.save();
        self.syncServerStats();

        return result;
      };
    };

  /*
   * XP
   */

  FeatureManager.prototype.xpForNextLevel =
    function() {
      return this.state.level * 100;
    };

  FeatureManager.prototype.addXP =
    function(amount) {
      amount = Number(amount) || 0;

      if (amount <= 0) {
        return;
      }

      this.state.xp =
        Number(this.state.xp || 0) +
        amount;

      var needed =
        this.xpForNextLevel();

      while (this.state.xp >= needed) {
        this.state.xp -= needed;
        this.state.level += 1;
        needed = this.xpForNextLevel();
      }

      this.save();
    };

  /*
   * Achievements
   */

  FeatureManager.prototype.unlockAchievement =
    function(key) {
      if (this.state.achievements[key]) {
        return false;
      }

      this.state.achievements[key] =
        Date.now();

      this.addXP(25);
      this.save();

      return true;
    };

  FeatureManager.prototype.checkAchievements =
    function() {
      var score =
        Number(this.game.score) || 0;

      if (score >= 1000) {
        this.unlockAchievement(
          "score-1000"
        );
      }

      if (score >= 5000) {
        this.unlockAchievement(
          "score-5000"
        );
      }

      if (score >= 10000) {
        this.unlockAchievement(
          "score-10000"
        );
      }

      if (this.game.over &&
          this.game.won) {
        this.unlockAchievement(
          "game-won"
        );
      }

      if ((this.state.bestCombo || 0) >= 5) {
        this.unlockAchievement(
          "combo-5"
        );
      }

      if ((this.state.bestCombo || 0) >= 10) {
        this.unlockAchievement(
          "combo-10"
        );
      }
    };

  /*
   * Daily challenge
   */

  FeatureManager.prototype.makeDailyChallenge =
    function() {
      var date =
        new Date().toISOString()
          .slice(0, 10);

      var seed = 0;

      for (var i = 0; i < date.length; i += 1) {
        seed =
          ((seed << 5) - seed) +
          date.charCodeAt(i);

        seed |= 0;
      }

      var challenges = this.featureConfig.dailyChallenges || [];

      if (!challenges.length) {
        challenges = [{
          key: "score",
          target: 1000,
          reward: 25,
          text: "Score 1,000 points"
        }];
      }

      var index =
        Math.abs(seed) %
        challenges.length;

      return {
        date: date,
        challenge: challenges[index]
      };
    };

  /*
   * Undo
   */

  FeatureManager.prototype.undo =
    function() {
      if (!this.history.length) {
        return false;
      }

      var state =
        this.history.pop();

      if (!state) {
        return false;
      }

      this.game.grid =
        state.grid;

      this.game.score =
        state.score;

      this.game.over =
        state.over;

      this.game.won =
        state.won;

      if (state.keepPlaying !== undefined) {
        this.game.keepPlaying =
          state.keepPlaying;
      }

      if (this.game.startTimer &&
          state.roundEndTime) {
        this.game.startTimer(
          state.roundEndTime
        );
      }

      this.game.actuate();

      return true;
    };

  /*
   * UI
   */

  FeatureManager.prototype.installUI =
    function() {
      var container =
        document.getElementById(
          "drissnow-features"
        );

      if (!container) {
        return;
      }

      /*
       * Economy UI is created by
       * economy_chart.js.
       *
       * The remaining feature controls can
       * be attached here without adding the
       * chart implementation to this file.
       */
    };

  FeatureManager.prototype.applyTheme =
    function(theme) {
      if (!this.themes[theme]) {
        theme = "classic";
      }

      this.theme = theme;
      this.state.theme = theme;

      document.body.setAttribute(
        "data-drissnow-theme",
        theme
      );

      this.save();
    };

  FeatureManager.prototype.render =
    function() {
      if (this.creditEconomy) {
        this.creditEconomy.render();
      }
    };

  /*
   * Server statistics
   */

  FeatureManager.prototype.serverStatsPayload =
    function() {
      return {
        level:
          Number(this.state.level || 1),

        xp:
          Number(this.state.xp || 0),

        highScore:
          Number(this.state.highScore || 0),

        gamesPlayed:
          Number(this.state.gamesPlayed || 0),

        gamesWon:
          Number(this.state.gamesWon || 0),

        bestCombo:
          Number(this.state.bestCombo || 0)
      };
    };

  FeatureManager.prototype.syncServerStats =
    async function() {
      if (this.syncing) {
        return;
      }

      this.syncing = true;

      try {
        await this.apiRequest(
          "/stats",
          "POST",
          this.serverStatsPayload()
        );
      } catch (error) {
        console.error(
          "Unable to sync feature stats:",
          error
        );
      } finally {
        this.syncing = false;
      }
    };

  FeatureManager.prototype.loadServerStats =
    async function() {
      try {
        var data =
          await this.apiRequest(
            "/stats",
            "GET",
            {}
          );

        if (!data || !data.stats) {
          return;
        }

        var stats = data.stats;

        this.state.level =
          Number(stats.level) ||
          this.state.level;

        this.state.xp =
          Number(stats.xp) ||
          this.state.xp;

        this.state.highScore =
          Number(stats.high_score) ||
          this.state.highScore;

        this.state.gamesPlayed =
          Number(stats.games_played) ||
          this.state.gamesPlayed;

        this.state.gamesWon =
          Number(stats.games_won) ||
          this.state.gamesWon;

        this.state.bestCombo =
          Number(stats.best_combo) ||
          this.state.bestCombo;

        this.save();
        this.render();
      } catch (error) {
        console.error(
          "Unable to load feature stats:",
          error
        );
      }
    };

  window.FeatureManager =
    FeatureManager;

})(window);
function HTMLActuator() {
  this.tileContainer = document.querySelector(".tile-container");
  this.scoreContainer = document.querySelector(".score-container");
  this.bestContainer = document.querySelector(".best-container");
  this.creditsContainer = document.querySelector(".credits-container");
  this.timerContainer = document.querySelector(".timer-container");
  this.timerInput = document.querySelector(".timer-input");
  this.gameOverBanner = document.querySelector(".game-over-banner");
  this.gameOverText = document.querySelector(".game-over-text");
  this.noCreditsOverlay = document.querySelector(".no-credits-overlay");
  this.prizeToast = document.querySelector(".prize-toast");
  this.prizeToastText = document.querySelector(".prize-toast-text");
  this.score = 0;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;

  window.requestAnimationFrame(function () {
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) self.addTile(cell);
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    if (metadata.terminated && metadata.over) {
      self.setGameOverReason("Game over!");
    }
  });
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container && container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

HTMLActuator.prototype.positionClass = function (position) {
  return "tile-position-" + (position.x + 1) + "-" + (position.y + 1);
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;
  var wrapper = document.createElement("div");
  var inner = document.createElement("div");
  var position = tile.previousPosition || {
    x: tile.x,
    y: tile.y
  };
  var classes = [
    "tile",
    "tile-" + tile.value,
    this.positionClass(position)
  ];

  if (tile.value > 2048) {
    classes.push("tile-super");
  }

  wrapper.className = classes.join(" ");
  inner.className = "tile-inner";
  inner.textContent = tile.value;
  wrapper.appendChild(inner);
  this.tileContainer.appendChild(wrapper);

  // A tile that has moved gets its final position after the initial
  // render frame, allowing the existing CSS transition to animate it.
  if (tile.previousPosition) {
    window.requestAnimationFrame(function () {
      wrapper.className = "tile tile-" + tile.value + " " +
        self.positionClass({ x: tile.x, y: tile.y });
      if (tile.value > 2048) {
        wrapper.classList.add("tile-super");
      }
    });
  } else {
    wrapper.classList.add("tile-new");
  }

  if (tile.mergedFrom) {
    wrapper.classList.add("tile-merged");
  }
};

HTMLActuator.prototype.updateScore = function (score) {
  this.score = score;
  if (this.scoreContainer) {
    this.scoreContainer.textContent = score;
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  if (this.bestContainer) {
    this.bestContainer.textContent = bestScore;
  }
};

HTMLActuator.prototype.updateCredits = function (credits) {
  if (this.creditsContainer) {
    this.creditsContainer.textContent = Number(credits) || 0;
  }
};

HTMLActuator.prototype.updateTimer = function (seconds) {
  var value = Math.max(0, Number(seconds) || 0);
  var minutes = Math.floor(value / 60);
  var secs = value % 60;

  if (this.timerContainer) {
    this.timerContainer.textContent =
      String(minutes).padStart(2, "0") + ":" +
      String(secs).padStart(2, "0");
    this.timerContainer.classList.toggle("timer-low", value <= 10);
  }
};

HTMLActuator.prototype.getRoundDurationInput = function () {
  return this.timerInput ? Number(this.timerInput.value) : NaN;
};

HTMLActuator.prototype.setTimerInputEnabled = function (enabled) {
  if (this.timerInput) {
    this.timerInput.disabled = !enabled;
  }
};

HTMLActuator.prototype.setGameOverReason = function (reason) {
  if (this.gameOverText && reason) {
    this.gameOverText.textContent = reason;
  }

  if (this.gameOverBanner) {
    this.gameOverBanner.classList.add("game-over-visible");
  }
};

HTMLActuator.prototype.hideGameOver = function () {
  if (this.gameOverBanner) {
    this.gameOverBanner.classList.remove("game-over-visible");
  }
};

HTMLActuator.prototype.noCredits = function () {
  if (this.noCreditsOverlay) {
    this.noCreditsOverlay.classList.add("no-credits-visible");
  }
};

HTMLActuator.prototype.hideNoCredits = function () {
  if (this.noCreditsOverlay) {
    this.noCreditsOverlay.classList.remove("no-credits-visible");
  }
};

HTMLActuator.prototype.showPrizeToast = function (message, amount, prefix) {
  if (!this.prizeToast || !this.prizeToastText) return;

  var text = message ||
    ((prefix || "") + (Number(amount) || 0) + " credit(s)");

  this.prizeToastText.textContent = text;
  this.prizeToast.classList.add("prize-toast-visible");
  clearTimeout(this._toastTimer);

  var self = this;
  this._toastTimer = setTimeout(function () {
    self.prizeToast.classList.remove("prize-toast-visible");
  }, 2500);
};

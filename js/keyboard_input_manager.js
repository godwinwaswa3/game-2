function KeyboardInputManager() {
  this.events = {};
  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) this.events[event] = [];
  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event] || [];
  callbacks.forEach(function (callback) { callback(data); });
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;
  var map = { 38: 0, 39: 1, 40: 2, 37: 3 };

  document.addEventListener("keydown", function (event) {
    var modifiers = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    var mapped = map[event.which];

    if (!modifiers && mapped !== undefined) {
      event.preventDefault();
      self.emit("move", mapped);
    }

    if (!modifiers && event.which === 82) {
      self.restart(event);
    }
  });

  var restartButton = document.querySelector(".restart-button");
  if (restartButton) {
    restartButton.addEventListener("click", function (event) {
      event.preventDefault();
      self.emit("restart");
    });
  }

  var touchStartClientX;
  var touchStartClientY;
  var gameContainer = document.querySelector(".game-container");

  if (!gameContainer) return;

  gameContainer.addEventListener("touchstart", function (event) {
    if (!event.touches || event.touches.length !== 1) return;
    touchStartClientX = event.touches[0].clientX;
    touchStartClientY = event.touches[0].clientY;
  }, { passive: true });

  gameContainer.addEventListener("touchend", function (event) {
    if (touchStartClientX === undefined || !event.changedTouches.length) return;

    var touch = event.changedTouches[0];
    var dx = touch.clientX - touchStartClientX;
    var dy = touch.clientY - touchStartClientY;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    var threshold = 10;

    touchStartClientX = undefined;
    touchStartClientY = undefined;

    if (Math.max(absDx, absDy) < threshold) return;
    event.preventDefault();

    self.emit("move", absDx > absDy ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  }, { passive: false });
};

KeyboardInputManager.prototype.restart = function (event) {
  if (event) event.preventDefault();
  this.emit("restart");
};

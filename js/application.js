(function(window, document) {
  "use strict";

  async function boot() {
    try {
      window.PEANUT_CREDITS_PROXY_URL =
        "http://localhost:3001";

      window.DrissnowAppData =
        await window.DrissnowJsonData.loadAll();
    } catch (error) {
      console.error("DrissNow JSON data bootstrap failed:", error);
      var message = document.querySelector(".redeem-message");
      if (message) {
        message.textContent =
          "Game data could not be loaded. Start the site through an HTTP server.";
        message.className = "redeem-message error";
      }
      return;
    }

    window.requestAnimationFrame(function() {
      var game = new GameManager(
        Number(window.DrissnowAppData.game.gridSize) || 4,
        KeyboardInputManager,
        HTMLActuator,
        LocalStorageManager,
        CreditsManager
      );

      window.drissnowGame = game;

      if (typeof FeatureManager !== "undefined") {
        window.drissnowFeatures = new FeatureManager(game);
      }

      var redeemButton = document.querySelector(".redeem-button");
      var redeemInput = document.querySelector(".redeem-input");
      var redeemMessage = document.querySelector(".redeem-message");

      if (redeemButton) {
        redeemButton.addEventListener("click", async function() {
          try {
            var code = (redeemInput.value || "").trim();

            if (!code) {
              redeemMessage.textContent = "Enter a peanut code.";
              redeemMessage.className = "redeem-message error";
              return;
            }

            var result = await game.creditsManager.redeemCode(code);
            redeemMessage.textContent = result.message;
            redeemMessage.className = "redeem-message " +
              (result.success ? "success" : "error");
            redeemInput.value = "";

            var credits = await game.creditsManager.getCredits();
            game.actuator.updateCredits(credits);

if (result.success) {

  /*
   * The redemption API must return the intrinsic
   * duration_seconds from the codes table.
   */
var codeAmount = Number(result.amount);

if (
  !isFinite(codeAmount) ||
  codeAmount <= 0
) {
  console.warn(
    "[DrissNow] Redeemed code has no valid amount:",
    result
  );

  await game.setup();

} else {

  console.log(
    "[DrissNow] Redeemed code starting amount:",
    codeAmount
  );

  await game.startRedeemedRound(
    codeAmount
  );
}
  
}

            
          } catch (err) {
            console.error("Redeem error:", err);
            redeemMessage.textContent =
              "Something went wrong. Please try again.";
            redeemMessage.className = "redeem-message error";
          }
        });
      }

      var gameContainer = document.querySelector(".game-container");

      function squareUpBoard() {
        if (!gameContainer) return;
        var width = gameContainer.offsetWidth;
        if (width > 0) gameContainer.style.height = width + "px";
      }

      squareUpBoard();
      window.addEventListener("resize", squareUpBoard);
      window.addEventListener("orientationchange", squareUpBoard);
    });
  }

  boot();
})(window, document);

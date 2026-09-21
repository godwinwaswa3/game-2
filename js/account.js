(function (window, document) {
  "use strict";

  console.log("[Account] account.js loaded");


  /*
   * =========================================================
   * CONFIG
   * =========================================================
   */

  var AUTH_API =
    "http://127.0.0.1:3000/api/auth";

  var ECONOMY_PROXY =
    "http://127.0.0.1:3001/curl";

  var TOKEN_KEY =
    "drissnowAuthToken";

  var USER_KEY =
    "drissnowUser";


  /*
   * =========================================================
   * DOM
   * =========================================================
   */

  var details =
    document.getElementById(
      "account-details"
    );

  var balance =
    document.getElementById(
      "account-balance"
    );

  var message =
    document.getElementById(
      "account-message"
    );

  var signout =
    document.getElementById(
      "signout-button"
    );


  /*
   * =========================================================
   * IMMEDIATE LOAD TEST
   * =========================================================
   */

  if (message) {

    message.textContent =
      "Account script loaded.";

    message.className =
      "account-message loading";
  }


  /*
   * =========================================================
   * AUTH STORAGE
   * =========================================================
   */

  function getToken() {

    return localStorage.getItem(
      TOKEN_KEY
    );
  }


  function getStoredUser() {

    try {

      return JSON.parse(
        localStorage.getItem(
          USER_KEY
        ) || "null"
      );

    } catch (error) {

      return null;
    }
  }


  function clearSession() {

    localStorage.removeItem(
      TOKEN_KEY
    );

    localStorage.removeItem(
      USER_KEY
    );
  }


  //new functions
  async function loadCurrentEconomyBalance(playerId) {

  const result =
    await economyRequest(
      "/economy/current",
      "POST",
      {},
      playerId
    );


  if (
    !result ||
    result.success !== true
  ) {

    throw new Error(
      result &&
      result.message
        ? result.message
        : "Unable to load economy balance."
    );

  }


  const balance =
    Number(
      result.balance
    );


  if (!Number.isFinite(balance)) {

    throw new Error(
      "Economy API returned an invalid balance."
    );

  }


  setBalance(
    balance
  );


  console.log(
    "[Account Economy] LIVE BALANCE:",
    balance
  );


  return result;
}

  //new functions 2
  
function startLiveBalance(playerId) {

  if (economyTimer) {
    clearInterval(economyTimer);
  }


  loadCurrentEconomyBalance(
    playerId
  ).catch(function(error) {

    console.error(
      "[Account Economy] Initial balance error:",
      error
    );

  });


  economyTimer =
    setInterval(
      function() {

        loadCurrentEconomyBalance(
          playerId
        ).catch(function(error) {

          console.error(
            "[Account Economy] Balance update error:",
            error
          );

        });

      },
      1000
    );
}

  /*
   * =========================================================
   * MESSAGE
   * =========================================================
   */

  function setMessage(
    text,
    type
  ) {

    if (!message) {
      return;
    }

    message.textContent =
      text || "";

    message.className =
      "account-message";

    if (type) {

      message.classList.add(
        type
      );
    }
  }


  /*
   * =========================================================
   * FORMAT LABEL
   * =========================================================
   */

  function formatLabel(
    key
  ) {

    return String(key)
      .replace(/_/g, " ")
      .replace(
        /([a-z])([A-Z])/g,
        "$1 $2"
      )
      .replace(
        /\b\w/g,
        function (letter) {
          return letter.toUpperCase();
        }
      );
  }


  /*
   * =========================================================
   * SENSITIVE FIELDS
   * =========================================================
   */

  function isSensitive(
    key
  ) {

    var sensitive = [
      "password",
      "password_hash",
      "token",
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
      "secret",
      "secret_key",
      "secretKey"
    ];

    return (
      sensitive.indexOf(key) !== -1
    );
  }


  /*
   * =========================================================
   * DISPLAY ONE FIELD
   * =========================================================
   */

  function addField(
    key,
    value
  ) {

    if (isSensitive(key)) {
      return;
    }


    var row =
      document.createElement(
        "div"
      );

    row.className =
      "account-detail";


    var label =
      document.createElement(
        "span"
      );

    label.className =
      "account-detail-label";

    label.textContent =
      formatLabel(key);


    var valueElement =
      document.createElement(
        "span"
      );

    valueElement.className =
      "account-detail-value";


    if (
      value !== null &&
      typeof value === "object"
    ) {

      var pre =
        document.createElement(
          "pre"
        );

      pre.className =
        "account-detail-object";

      pre.textContent =
        JSON.stringify(
          value,
          null,
          2
        );

      valueElement.appendChild(
        pre
      );

    } else if (
      value === null ||
      value === undefined
    ) {

      valueElement.textContent =
        "NULL";

    } else {

      valueElement.textContent =
        String(value);
    }


    row.appendChild(
      label
    );

    row.appendChild(
      valueElement
    );

    details.appendChild(
      row
    );
  }


  /*
   * =========================================================
   * DISPLAY ACCOUNT
   * =========================================================
   */

  function displayAccount(
    data
  ) {

    if (!details) {
      return;
    }


    details.innerHTML = "";


    /*
     * Find the actual account object.
     */

    var account =
      data.account ||
      data.user ||
      data;


    if (
      !account ||
      typeof account !== "object"
    ) {

      details.innerHTML =
        '<div class="account-loading">' +
        "No account data was returned." +
        "</div>";

      return;
    }


    /*
     * Display all top-level fields.
     */

    Object.keys(account)
      .forEach(
        function (key) {

          addField(
            key,
            account[key]
          );

        }
      );


    /*
     * If /me returns a separate player
     * object, display it too.
     */

    if (
      data.player &&
      typeof data.player === "object"
    ) {

      addField(
        "player",
        data.player
      );

    }


    /*
     * If account.player exists, it has
     * already been included above.
     */


    /*
     * If nothing was displayed.
     */

    if (
      details.children.length === 0
    ) {

      details.innerHTML =
        '<div class="account-loading">' +
        "No displayable account information." +
        "</div>";
    }
  }


  /*
   * =========================================================
   * LOAD /api/auth/me
   * =========================================================
   */

  async function loadUserDetails() {

    var token =
      getToken();


    console.log(
      "[Account] Token exists:",
      !!token
    );


    if (!token) {

      setMessage(
        "No login session found.",
        "error"
      );

      setTimeout(
        function () {

          window.location.href =
            "signin.html";

        },
        1000
      );

      return null;
    }


    var url =
      AUTH_API + "/me";


    console.log(
      "[Account] Requesting:",
      url
    );


    var response;


    try {

      response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              "Authorization":
                "Bearer " + token,

              "Accept":
                "application/json"
            }
          }
        );

    } catch (error) {

      console.error(
        "[Account] /me connection error:",
        error
      );

      throw new Error(
        "Cannot connect to authentication server on port 3000."
      );
    }


    var text =
      await response.text();


    console.log(
      "[Account] /me HTTP status:",
      response.status
    );

    console.log(
      "[Account] /me response:",
      text
    );


    var data;


    try {

      data =
        JSON.parse(
          text
        );

    } catch (error) {

      throw new Error(
        "Authentication server returned invalid JSON."
      );
    }


    if (
      response.status === 401
    ) {

      clearSession();

      window.location.href =
        "signin.html";

      return null;
    }


    if (
      !response.ok
    ) {

      throw new Error(
        data.message ||
        "Unable to load user details."
      );
    }


    /*
     * Display the complete safe
     * account information.
     */

    displayAccount(
      data
    );


    /*
     * Save latest account response.
     */

    try {

      localStorage.setItem(
        USER_KEY,
        JSON.stringify(
          data.account ||
          data.user ||
          data
        )
      );

    } catch (error) {

      console.warn(
        "[Account] Could not save user data:",
        error
      );
    }


    return (
      data.account ||
      data.user ||
      data
    );
  }


  /*
   * =========================================================
   * GET PLAYER ID
   * =========================================================
   */

  function getPlayerId(
    account
  ) {

    if (!account) {
      return null;
    }


    if (account.playerId) {
      return account.playerId;
    }


    if (account.player_id) {
      return account.player_id;
    }


    if (
      account.player &&
      account.player.id
    ) {

      return account.player.id;
    }


    var stored =
      getStoredUser();


    if (stored) {

      if (stored.playerId) {
        return stored.playerId;
      }

      if (stored.player_id) {
        return stored.player_id;
      }
    }


    return null;
  }


  /*
   * =========================================================
   * ECONOMY REQUEST
   * =========================================================
   */

  async function getEconomyBalance(
    playerId
  ) {

    if (!playerId) {

      throw new Error(
        "Player ID was not found."
      );
    }


    var requestBody = {

      path:
        "/game/economy/current",

      method:
        "POST",

      playerId:
        playerId,

      body:
        {}

    };


    console.log(
      "[Account Economy] Request:",
      requestBody
    );


    var response =
      await fetch(
        ECONOMY_PROXY,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json"
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );


    var text =
      await response.text();


    console.log(
      "[Account Economy] HTTP:",
      response.status
    );

    console.log(
      "[Account Economy] Response:",
      text
    );


    var data;


    try {

      data =
        JSON.parse(
          text
        );

    } catch (error) {

      throw new Error(
        "Economy proxy returned invalid JSON."
      );
    }


    /*
     * Proxy response:
     *
     * {
     *   success: true,
     *   data: {
     *      balance: ...
     *   }
     * }
     */

    var result =
      data.data !== undefined
        ? data.data
        : data;


    if (
      result.success === false
    ) {

      throw new Error(
        result.message ||
        "Economy balance request failed."
      );
    }


    var amount =
      Number(
        result.balance
      );


    if (
      !isFinite(amount)
    ) {

      throw new Error(
        "Economy returned an invalid balance."
      );
    }


    if (balance) {

      balance.classList.remove(
        "loading"
      );

      balance.textContent =
        amount.toFixed(6);
    }


    return result;
  }


  /*
   * =========================================================
   * LOAD ECONOMY
   * =========================================================
   */

  async function loadBalance(
    account
  ) {

    try {

      var playerId =
        getPlayerId(
          account
        );


      console.log(
        "[Account Economy] Player ID:",
        playerId
      );


      if (!playerId) {

        throw new Error(
          "User details loaded, but no player ID was returned."
        );
      }


      await getEconomyBalance(
        playerId
      );


      setMessage(
        "Account information loaded.",
        "success"
      );

    } catch (error) {

      console.error(
        "[Account Economy] Error:",
        error
      );


      /*
       * Account details can still remain
       * visible even if economy fails.
       */

      setMessage(
        "Account loaded. " +
        error.message,
        "error"
      );
    }
  }


  /*
   * =========================================================
   * SIGN OUT
   * =========================================================
   */

  if (signout) {

    signout.addEventListener(
      "click",
      async function () {

        signout.disabled =
          true;

        signout.textContent =
          "SIGNING OUT...";


        var token =
          getToken();


        try {

          if (token) {

            await fetch(
              AUTH_API + "/signout",
              {
                method: "POST",

                headers: {
                  "Authorization":
                    "Bearer " + token
                }
              }
            );
          }

        } catch (error) {

          console.warn(
            "[Account] Signout failed:",
            error
          );

        } finally {

          clearSession();

          window.location.href =
            "signin.html";
        }
      }
    );
  }


  /*
   * =========================================================
   * START
   * =========================================================
   */

  async function start() {

    console.log(
      "[Account] Starting account page..."
    );


    try {

      setMessage(
        "Loading account...",
        "loading"
      );


      var account =
        await loadUserDetails();


      if (!account) {
        return;
      }


      /*
       * IMPORTANT:
       *
       * User details are displayed independently
       * from the economy request.
       *
       * Therefore an economy error cannot make
       * the account details disappear.
       */

      await loadBalance(
        account
      );


    } catch (error) {

      console.error(
        "[Account] Fatal error:",
        error
      );


      if (details) {

        details.innerHTML =
          '<div class="account-loading">' +
          "Unable to load account information." +
          "</div>";
      }


      setMessage(
        error.message ||
        "Unable to load account information.",
        "error"
      );
    }
  }


  start();


})(window, document);
/*
 * Browser-side Peanut Credits client.
 *
 * IMPORTANT: browsers cannot execute the curl command directly. This file
 * sends requests to the local curl proxy (credits_curl_proxy.js). The proxy
 * executes curl server-side and forwards the response from the Peanut
 * Credits API, which can then read/write MariaDB.
 */
function CreditsManager() {
  this.playerIdKey = "peanutGamePlayerId";
  this.proxyUrl = (
    window.PEANUT_CREDITS_PROXY_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");

  this.playerId = this.getStoredPlayerId();
  if (!this.playerId) {
    this.playerId = this.generatePlayerId();
    this.storePlayerId(this.playerId);
  }
}

CreditsManager.prototype.getStoredPlayerId = function () {
  try {
    return window.localStorage.getItem(this.playerIdKey);
  } catch (error) {
    return null;
  }
};

CreditsManager.prototype.storePlayerId = function (playerId) {
  try {
    window.localStorage.setItem(this.playerIdKey, playerId);
  } catch (error) {
    console.warn("Could not save player ID locally.", error);
  }
};

CreditsManager.prototype.generatePlayerId = function () {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/*
 * All real credit data comes from the Peanut Credits API.
 * The proxy executes curl; the browser never calculates the balance.
 */
CreditsManager.prototype.request = function (path, method, body) {
  var self = this;

  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();

    xhr.open("POST", self.proxyUrl + "/curl", true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 15000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      var data = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (error) {
        reject(new Error("Invalid response from curl proxy."));
        return;
      }

      if (data.playerId) {
        self.playerId = data.playerId;
        self.storePlayerId(data.playerId);
      }

      if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) {
        resolve(data.data || data);
        return;
      }

      reject(new Error(
        data.message || "Credits API error (" + xhr.status + ")."
      ));
    };

    xhr.onerror = function () {
      reject(new Error("Unable to connect to the curl proxy."));
    };

    xhr.ontimeout = function () {
      reject(new Error("The curl proxy request timed out."));
    };

    try {
      xhr.send(JSON.stringify({
        path: path,
        method: method,
        playerId: self.playerId,
        body: body
      }));
    } catch (error) {
      reject(error);
    }
  });
};

CreditsManager.prototype.getAccount = function () {
  return this.request("", "GET");
};

CreditsManager.prototype.getCredits = function () {
  return this.getAccount().then(function (account) {
    return Number(account.credits) || 0;
  });
};

CreditsManager.prototype.hasCredits = function () {
  return this.getAccount().then(function (account) {
    return account.canPlay === true || Number(account.credits) > 0;
  });
};

CreditsManager.prototype.addCredits = function () {
  return Promise.reject(new Error(
    "Credits are managed by the Peanut Credits API."
  ));
};

CreditsManager.prototype.useCredit = function () {
  return this.request("/use", "POST").then(function (data) {
    if (!data.success) {
      throw new Error(data.message || "Unable to use credit.");
    }
    return data;
  });
};

CreditsManager.prototype.redeemCode = function (code) {
  code = (code || "").trim().toUpperCase();
  if (!code) {
    return Promise.resolve({
      success: false,
      message: "Please enter a redemption code."
    });
  }
  return this.request("/redeem", "POST", { code: code });
};

CreditsManager.prototype.recordMilestone = function (value) {
  return this.request("/milestones", "POST", { value: value });
};

CreditsManager.prototype.settleScoreBonus = function (score) {
  return this.request("/score-bonus", "POST", {
    score: Math.max(0, Number(score) || 0)
  });
};

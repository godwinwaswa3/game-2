(function(window) {
  "use strict";

  var DEFAULT_BASE = "data/";
  var FILES = {
    game: "game_config.json",
    features: "feature_config.json",
    playerDefaults: "player_state.json"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function JsonDataManager(basePath) {
    this.basePath = (basePath || DEFAULT_BASE).replace(/\/$/, "") + "/";
    this.cache = Object.create(null);
  }

  JsonDataManager.prototype.load = async function(name) {
    if (!FILES[name]) {
      throw new Error("Unknown JSON data file: " + name);
    }

    if (Object.prototype.hasOwnProperty.call(this.cache, name)) {
      return clone(this.cache[name]);
    }

    var response = await fetch(this.basePath + FILES[name], {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "Unable to load " + FILES[name] + " (HTTP " + response.status + ")."
      );
    }

    var data = await response.json();
    this.cache[name] = data;
    return clone(data);
  };

  JsonDataManager.prototype.loadAll = async function() {
    var self = this;
    await Promise.all(Object.keys(FILES).map(function(name) {
      return self.load(name);
    }));

    return {
      game: clone(self.cache.game),
      features: clone(self.cache.features),
      playerDefaults: clone(self.cache.playerDefaults)
    };
  };

  window.DrissnowJsonData = new JsonDataManager(
    window.DRISSNOW_DATA_PATH || DEFAULT_BASE
  );
})(window);

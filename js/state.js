// ============================================================
// COSMIC FRONTIER - Game State
// Save/load, state initialization, and state utilities
// ============================================================

const State = (() => {
  const SAVE_KEY = 'cosmicFrontier_save';
  const VERSION = '1.0.0';

  // Default state factory
  function createDefault() {
    return {
      version: VERSION,
      lastSave: Date.now(),
      playTime: 0,

      // Resources: { resourceId: amount }
      resources: { iron: 10, silicon: 5 },

      // Per-location data
      locations: {
        earth: {
          id: 'earth',
          visited: true,
          baseBuilt: false,
          buildings: {},      // { buildingId: count }
          totalMined: {},     // { resourceId: total }
          secretTriggered: false,
          signalArrayBuilt: false,
        }
      },

      // Current active location (where player is viewing)
      currentLocation: 'earth',

      // Travel/mission queue
      activeMission: null, // { from, to, rocketId, startTime, duration, purpose }

      // Research
      research: {
        completed: [],     // [techId, ...]
        active: null,      // { techId, startTime, duration }
        queue: [],         // [techId, ...] (future queue)
      },

      // Built rockets (in hangar)
      hangar: [],          // [{ id, rocketId, built: timestamp }]
      nextHangarId: 1,

      // Missions completed
      missionsCompleted: [],

      // Secrets discovered
      secretsFound: [],

      // Achievements earned
      achievements: [],

      // Progression: which tabs are unlocked
      unlockedTabs: ['base', 'research', 'log'],

      // High-level game stage for scene rendering
      gameStage: 'earth_early',

      // UI state
      ui: {
        activeTab: 'base',
        notifications: [],
        tutorialStep: 0,
        tutorialDone: false,
      },

      // Statistics
      stats: {
        totalMined: 0,
        totalLaunches: 0,
        totalResearched: 0,
        basesBuilt: 0,
        secretsFound: 0,
        locationsVisited: 1,
        playTime: 0,
      },
    };
  }

  let _state = null;

  function init() {
    const saved = load();
    if (saved) {
      _state = migrate(saved);
    } else {
      _state = createDefault();
    }
    return _state;
  }

  function get() {
    return _state;
  }

  function save() {
    try {
      _state.lastSave = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(_state));
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  function reset() {
    localStorage.removeItem(SAVE_KEY);
    _state = createDefault();
    return _state;
  }

  function migrate(saved) {
    // Version migration - for now just return as-is with defaults filled in
    const def = createDefault();
    return deepMerge(def, saved);
  }

  function deepMerge(target, source) {
    const result = Object.assign({}, target);
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // ---- Location helpers ----
  function getLocation(locId) {
    const s = _state;
    if (!s.locations[locId]) {
      s.locations[locId] = {
        id: locId,
        visited: false,
        baseBuilt: false,
        buildings: {},
        totalMined: {},
        secretTriggered: false,
        signalArrayBuilt: false,
      };
    }
    return s.locations[locId];
  }

  function visitLocation(locId) {
    const loc = getLocation(locId);
    if (!loc.visited) {
      loc.visited = true;
      _state.stats.locationsVisited++;
    }
  }

  // ---- Resource helpers ----
  function getResource(resId) {
    return _state.resources[resId] || 0;
  }

  function addResource(resId, amount) {
    if (!_state.resources[resId]) _state.resources[resId] = 0;
    _state.resources[resId] = Math.max(0, _state.resources[resId] + amount);
    _state.stats.totalMined += amount;
  }

  function spendResources(costs) {
    // Check affordability first
    for (const [res, amount] of Object.entries(costs)) {
      if (getResource(res) < amount) return false;
    }
    // Spend
    for (const [res, amount] of Object.entries(costs)) {
      _state.resources[res] -= amount;
    }
    return true;
  }

  function canAfford(costs) {
    for (const [res, amount] of Object.entries(costs)) {
      if (getResource(res) < amount) return false;
    }
    return true;
  }

  // ---- Tech helpers ----
  function hasResearched(techId) {
    return _state.research.completed.includes(techId);
  }

  function completeResearch(techId) {
    if (!hasResearched(techId)) {
      _state.research.completed.push(techId);
      _state.stats.totalResearched++;
    }
    _state.research.active = null;
  }

  function unlockTech(techId) {
    // Force-unlock a tech (from secrets)
    const tech = CONFIG.TECHS[techId];
    if (tech) {
      tech.locked = false;
    }
  }

  function getMiningMultiplier() {
    let mult = 1.0;
    for (const techId of _state.research.completed) {
      const tech = CONFIG.TECHS[techId];
      if (tech && tech.effect && tech.effect.miningMultiplier) {
        mult *= tech.effect.miningMultiplier;
      }
    }
    return mult;
  }

  function getResearchSpeedMultiplier() {
    let mult = 1.0;
    // Count research labs across all locations
    for (const locData of Object.values(_state.locations)) {
      const labCount = locData.buildings['research_lab'] || 0;
      mult += labCount * CONFIG.SETTINGS.researchLabSpeedBonus;
    }
    return mult;
  }

  function getStorageMax(resId) {
    let base = CONFIG.SETTINGS.baseStorage;
    // Cryo tech multiplier
    if (hasResearched('cryo_tech')) base *= 5;
    return base;
  }

  // ---- Building helpers ----
  function getBuildingCount(locId, buildingId) {
    const loc = getLocation(locId);
    return loc.buildings[buildingId] || 0;
  }

  function addBuilding(locId, buildingId) {
    const loc = getLocation(locId);
    if (!loc.buildings[buildingId]) loc.buildings[buildingId] = 0;
    loc.buildings[buildingId]++;
    if (buildingId === 'base_module') {
      loc.baseBuilt = true;
      _state.stats.basesBuilt++;
    }
    if (buildingId === 'signal_array') {
      loc.signalArrayBuilt = true;
    }
  }

  // ---- Hangar helpers ----
  function addToHangar(rocketId) {
    const entry = {
      id: _state.nextHangarId++,
      rocketId,
      built: Date.now(),
    };
    _state.hangar.push(entry);
    return entry;
  }

  function removeFromHangar(hangarId) {
    const idx = _state.hangar.findIndex(r => r.id === hangarId);
    if (idx >= 0) {
      _state.hangar.splice(idx, 1);
      return true;
    }
    return false;
  }

  // ---- Getters for location productivity ----
  function getLocationProduction(locId) {
    const locConfig = CONFIG.LOCATIONS[locId];
    const locState = getLocation(locId);
    if (!locConfig || !locState.baseBuilt) return {};

    const baseYield = locConfig.baseYield || {};
    const autoMinerCount = getBuildingCount(locId, 'auto_miner');
    const refineryCount = getBuildingCount(locId, 'refinery');
    const fusionCount = getBuildingCount(locId, 'fusion_reactor');
    const miningMult = getMiningMultiplier();

    const refineryBonus = refineryCount > 0 ? Math.pow(2.0, refineryCount) : 1.0;
    const fusionBonus = fusionCount > 0 ? Math.pow(3.0, fusionCount) : 1.0;

    const production = {};
    for (const [res, baseRate] of Object.entries(baseYield)) {
      const autoMinerRate = autoMinerCount * CONFIG.BUILDINGS.auto_miner.productionMultiplier;
      production[res] = baseRate * autoMinerRate * miningMult * refineryBonus * fusionBonus;
    }
    return production;
  }

  // ---- Achievement helpers ----
  // ---- Tab unlock helpers ----
  function getUnlockedTabs() {
    return _state.unlockedTabs || ['base', 'research', 'log'];
  }

  function unlockTab(tabId) {
    if (!_state.unlockedTabs) _state.unlockedTabs = ['base', 'research', 'log'];
    if (!_state.unlockedTabs.includes(tabId)) {
      _state.unlockedTabs.push(tabId);
      return true; // newly unlocked
    }
    return false;
  }

  function setGameStage(stage) {
    _state.gameStage = stage;
  }

  // ---- Achievement helpers ----
  function grantAchievement(achievementId) {
    if (!_state.achievements.includes(achievementId)) {
      _state.achievements.push(achievementId);
      return true;
    }
    return false;
  }

  function hasAchievement(achievementId) {
    return _state.achievements.includes(achievementId);
  }

  return {
    init, get, save, load, reset,
    getLocation, visitLocation,
    getResource, addResource, spendResources, canAfford,
    hasResearched, completeResearch, unlockTech,
    getMiningMultiplier, getResearchSpeedMultiplier, getStorageMax,
    getBuildingCount, addBuilding,
    addToHangar, removeFromHangar,
    getLocationProduction,
    grantAchievement, hasAchievement,
    getUnlockedTabs, unlockTab, setGameStage,
  };
})();

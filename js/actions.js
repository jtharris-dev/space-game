// ============================================================
// COSMIC FRONTIER - Player Actions
// All actions the player can take in the game
// ============================================================

const Actions = (() => {

  // ---- MINING ----
  function mine(locationId, focusResource) {
    const locConfig = CONFIG.LOCATIONS[locationId];
    if (!locConfig) return;

    const mult = State.getMiningMultiplier();
    const gained = {};
    const locState = State.getLocation(locationId);

    for (const [res, baseYield] of Object.entries(locConfig.baseYield)) {
      // Apply focus multiplier: focused res = 2×, others = 0.7×
      const focusMult = focusResource
        ? (res === focusResource ? 2.0 : 0.7)
        : 1.0;
      const amount = baseYield * mult * focusMult * (0.8 + Math.random() * 0.4);
      const max = State.getStorageMax(res);
      const current = State.getResource(res);
      const canAdd = Math.min(amount, max - current);
      if (canAdd > 0) {
        State.addResource(res, canAdd);
        gained[res] = canAdd;

        // Track per-location mining for secrets
        if (!locState.totalMined[res]) locState.totalMined[res] = 0;
        locState.totalMined[res] += canAdd;
      }
    }

    return gained;
  }

  // ---- RESEARCH ----
  function startResearch(techId) {
    const state = State.get();
    const tech = CONFIG.TECHS[techId];

    if (!tech) return { ok: false, reason: 'Unknown technology' };
    if (tech.locked) return { ok: false, reason: 'Technology locked' };
    if (State.hasResearched(techId)) return { ok: false, reason: 'Already researched' };
    if (state.research.active) return { ok: false, reason: 'Research already in progress' };

    // Check prerequisites
    for (const req of (tech.requires || [])) {
      if (!State.hasResearched(req)) {
        const reqTech = CONFIG.TECHS[req];
        return { ok: false, reason: `Requires: ${reqTech ? reqTech.name : req}` };
      }
    }

    // Check cost
    if (!State.canAfford(tech.cost)) {
      return { ok: false, reason: 'Insufficient resources' };
    }

    // Pay cost
    State.spendResources(tech.cost);

    // Start research
    state.research.active = {
      techId,
      startTime: Date.now(),
      duration: tech.researchTime,
    };

    UI.showNotification(`🔬 Researching: ${tech.name}`, 'info');
    UI.renderResearch();

    return { ok: true };
  }

  function queueResearch(techId) {
    const state = State.get();
    const tech = CONFIG.TECHS[techId];
    if (!tech) return { ok: false, reason: 'Unknown technology' };

    if (state.research.queue.includes(techId)) {
      return { ok: false, reason: 'Already queued' };
    }

    state.research.queue.push(techId);
    UI.showNotification(`📋 Queued: ${tech.name}`, 'info');
    return { ok: true };
  }

  function cancelResearch() {
    const state = State.get();
    if (!state.research.active) return;
    const tech = CONFIG.TECHS[state.research.active.techId];
    // Refund 50% of cost
    if (tech && tech.cost) {
      for (const [res, amount] of Object.entries(tech.cost)) {
        State.addResource(res, Math.floor(amount * 0.5));
      }
    }
    state.research.active = null;
    UI.renderResearch();
    UI.showNotification('Research cancelled (50% refund)', 'warning');
  }

  // ---- BUILDING ----
  function build(locationId, buildingId) {
    const state = State.get();
    const building = CONFIG.BUILDINGS[buildingId];
    if (!building) return { ok: false, reason: 'Unknown building' };

    // Check research requirement
    if (building.requires && !State.hasResearched(building.requires)) {
      const tech = CONFIG.TECHS[building.requires];
      return { ok: false, reason: `Requires research: ${tech ? tech.name : building.requires}` };
    }

    // Check base requirement
    const locData = State.getLocation(locationId);
    if (building.requiresBase && !locData.baseBuilt) {
      return { ok: false, reason: 'Requires base module first' };
    }

    // Check max count
    const currentCount = State.getBuildingCount(locationId, buildingId);
    if (building.maxPerLocation && currentCount >= building.maxPerLocation) {
      return { ok: false, reason: `Max ${building.maxPerLocation} allowed here` };
    }

    // Scale cost with count
    const cost = scaledBuildingCost(buildingId, currentCount);
    if (!State.canAfford(cost)) {
      return { ok: false, reason: 'Insufficient resources' };
    }

    // Pay and build
    State.spendResources(cost);
    State.addBuilding(locationId, buildingId);

    const locConfig = CONFIG.LOCATIONS[locationId];
    UI.showNotification(`🏗 Built ${building.name} on ${locConfig.name}`, 'success');
    UI.render();

    return { ok: true };
  }

  function scaledBuildingCost(buildingId, existingCount) {
    const building = CONFIG.BUILDINGS[buildingId];
    const scaleFactor = Math.pow(building.costScale, existingCount);
    const cost = {};
    for (const [res, base] of Object.entries(building.costBase)) {
      cost[res] = Math.ceil(base * scaleFactor);
    }
    return cost;
  }

  // ---- ROCKETS ----
  function buildRocket(rocketId) {
    const state = State.get();
    const rocketDef = CONFIG.ROCKETS[rocketId];
    if (!rocketDef) return { ok: false, reason: 'Unknown rocket' };

    if (!State.hasResearched(rocketDef.requires)) {
      const tech = CONFIG.TECHS[rocketDef.requires];
      return { ok: false, reason: `Requires: ${tech ? tech.name : rocketDef.requires}` };
    }

    if (!State.canAfford(rocketDef.cost)) {
      return { ok: false, reason: 'Insufficient resources' };
    }

    State.spendResources(rocketDef.cost);
    const entry = State.addToHangar(rocketId);

    UI.showNotification(`🚀 ${rocketDef.name} added to hangar!`, 'success');
    UI.renderLaunch();

    return { ok: true, hangarId: entry.id };
  }

  // ---- LAUNCH ----
  function launch(hangarId, destinationId) {
    const state = State.get();

    if (state.activeMission) {
      return { ok: false, reason: 'A mission is already in progress' };
    }

    const hangarEntry = state.hangar.find(h => h.id === hangarId);
    if (!hangarEntry) return { ok: false, reason: 'Rocket not found in hangar' };

    const rocketDef = CONFIG.ROCKETS[hangarEntry.rocketId];
    const destConfig = CONFIG.LOCATIONS[destinationId];
    if (!destConfig) return { ok: false, reason: 'Unknown destination' };

    // Check rocket can reach destination
    if (rocketDef.range && !rocketDef.range.includes(destinationId)) {
      return { ok: false, reason: `${rocketDef.name} cannot reach ${destConfig.name}` };
    }

    // Check destination is unlocked
    if (!destConfig.unlocked) {
      return { ok: false, reason: 'Destination not yet unlocked' };
    }

    // Calculate travel time (based on distance)
    const from = CONFIG.LOCATIONS[state.currentLocation];
    const duration = calculateTravelTime(from, destConfig, rocketDef);

    // Consume rocket from hangar
    State.removeFromHangar(hangarId);

    // Crewed: player travels. Uncrewed: send probe, player stays.
    const isCrewedMission = rocketDef.crewed !== false;

    // Create mission
    state.activeMission = {
      from: state.currentLocation,
      to: destinationId,
      rocketId: hangarEntry.rocketId,
      rocketName: rocketDef.name,
      startTime: Date.now(),
      duration,
      purpose: isCrewedMission ? 'travel' : 'test',
    };

    if (isCrewedMission) {
      UI.showNotification(`🚀 Launched! Heading to ${destConfig.name}...`, 'launch');
    } else {
      UI.showNotification(`📡 Unmanned probe launched toward ${destConfig.name}!`, 'launch');
    }
    UI.renderLaunch();
    UI.render();

    return { ok: true };
  }

  function calculateTravelTime(from, to, rocket) {
    // Distance in AU (approximate)
    const fromDist = from.distance || 0;
    const toDist = to.distance || 0;
    const distanceAU = Math.abs(toDist - fromDist);

    // Base time in seconds (1 AU = ~60 seconds game time)
    // Different rocket tiers are faster
    const tierSpeedFactors = { 1: 1.0, 2: 0.6, 3: 0.3, 4: 0.1, 5: 0.05, 6: 0.01 };
    const speedFactor = tierSpeedFactors[rocket.tier] || 1.0;

    // For light-year distances, use special calculation
    const distUnit = to.distanceUnit;
    let baseTime;
    if (distUnit === 'LY') {
      baseTime = to.distance * 300; // light-years → seconds (warp drive collapses this)
      return Math.max(30, Math.floor(baseTime * speedFactor));
    }

    baseTime = Math.max(5, distanceAU * 60);
    return Math.max(10, Math.floor(baseTime * speedFactor));
  }

  function getMissionProgress() {
    const state = State.get();
    const mission = state.activeMission;
    if (!mission) return null;

    const elapsed = (Date.now() - mission.startTime) / 1000;
    const progress = Math.min(1, elapsed / mission.duration);
    const remaining = Math.max(0, mission.duration - elapsed);

    return { ...mission, progress, remaining, elapsed };
  }

  // ---- UTILITY ----
  function formatTime(seconds) {
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function formatNumber(n) {
    if (n === undefined || n === null) return '0';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }

  function getResearchProgress() {
    const state = State.get();
    const active = state.research.active;
    if (!active) return null;

    const tech = CONFIG.TECHS[active.techId];
    const speedMult = State.getResearchSpeedMultiplier();
    const adjustedDuration = tech.researchTime / speedMult;
    const elapsed = (Date.now() - active.startTime) / 1000;
    const progress = Math.min(1, elapsed / adjustedDuration);
    const remaining = Math.max(0, adjustedDuration - elapsed);

    return { techId: active.techId, tech, progress, remaining, adjustedDuration };
  }

  function getBuildingCostNext(locationId, buildingId) {
    const count = State.getBuildingCount(locationId, buildingId);
    return scaledBuildingCost(buildingId, count);
  }

  return {
    mine, startResearch, queueResearch, cancelResearch,
    build, buildRocket, launch,
    getMissionProgress, getResearchProgress,
    formatTime, formatNumber,
    getBuildingCostNext, scaledBuildingCost,
  };
})();

// ============================================================
// COSMIC FRONTIER - Game Engine
// Main game loop, auto-production, mission timers, events
// ============================================================

const Engine = (() => {
  let lastTick = 0;
  let tickInterval = null;
  let saveInterval = null;
  let accumulatedTime = 0;

  function start() {
    lastTick = Date.now();
    tickInterval = setInterval(tick, CONFIG.SETTINGS.tickRate);
    saveInterval = setInterval(() => State.save(), CONFIG.SETTINGS.saveInterval);
  }

  function stop() {
    clearInterval(tickInterval);
    clearInterval(saveInterval);
  }

  function tick() {
    const now = Date.now();
    const dt = (now - lastTick) / 1000; // seconds
    lastTick = now;

    const state = State.get();
    state.stats.playTime = (state.stats.playTime || 0) + dt;

    // Process auto-production at all bases
    processProduction(dt);

    // Process active research
    processResearch(dt);

    // Process active mission
    processMission(dt);

    // Check for secrets
    checkSecrets();

    // Check achievements
    checkAchievements();

    // Check tab unlocks (progressive menu)
    checkTabUnlocks();

    // Update UI
    if (window.UI) UI.tick(dt);
  }

  function processProduction(dt) {
    const state = State.get();

    for (const [locId, locData] of Object.entries(state.locations)) {
      if (!locData.baseBuilt) continue;

      const production = State.getLocationProduction(locId);
      for (const [res, ratePerSec] of Object.entries(production)) {
        if (ratePerSec > 0) {
          const gained = ratePerSec * dt;
          const max = State.getStorageMax(res);
          const current = State.getResource(res);
          const canAdd = Math.min(gained, max - current);
          if (canAdd > 0) {
            State.addResource(res, canAdd);
            // Track per-location mined
            if (!locData.totalMined[res]) locData.totalMined[res] = 0;
            locData.totalMined[res] += canAdd;
          }
        }
      }
    }
  }

  function processResearch(dt) {
    const state = State.get();
    const active = state.research.active;
    if (!active) return;

    const elapsed = (Date.now() - active.startTime) / 1000;
    const tech = CONFIG.TECHS[active.techId];
    if (!tech) return;

    const speedMult = State.getResearchSpeedMultiplier();
    const adjustedDuration = tech.researchTime / speedMult;

    if (elapsed >= adjustedDuration) {
      // Research complete!
      State.completeResearch(active.techId);

      // Apply effects
      applyTechEffects(active.techId);

      // Unlock location if applicable
      const unlockLoc = tech.unlockLocation;
      if (unlockLoc && CONFIG.LOCATIONS[unlockLoc]) {
        CONFIG.LOCATIONS[unlockLoc].unlocked = true;
      }
      if (tech.unlockLocationAlt && CONFIG.LOCATIONS[tech.unlockLocationAlt]) {
        CONFIG.LOCATIONS[tech.unlockLocationAlt].unlocked = true;
      }

      UI.showNotification(`✅ Research complete: ${tech.name}`, 'success');
      UI.showDiscovery(active.techId);

      // Start next in queue
      if (state.research.queue.length > 0) {
        const nextTech = state.research.queue.shift();
        Actions.startResearch(nextTech);
      }
    }
  }

  function applyTechEffects(techId) {
    const tech = CONFIG.TECHS[techId];
    if (!tech || !tech.effect) return;

    if (tech.effect.enableAutoMine) {
      // Auto-mine is now available
    }
    if (tech.effect.enableBases) {
      // Base construction now available
    }
  }

  function processMission(dt) {
    const state = State.get();
    const mission = state.activeMission;
    if (!mission) return;

    const elapsed = (Date.now() - mission.startTime) / 1000;
    if (elapsed >= mission.duration) {
      // Mission complete!
      completeMission(mission);
    }
  }

  function completeMission(mission) {
    const state = State.get();
    state.activeMission = null;
    state.stats.totalLaunches++;
    state.missionsCompleted.push({ to: mission.to, purpose: mission.purpose, time: Date.now() });

    if (mission.purpose === 'test') {
      // Unmanned probe: collect samples and data, player stays on Earth
      const destConfig = CONFIG.LOCATIONS[mission.to];
      const gained = {};

      // Always gain some flight data
      const dataAmount = 3 + Math.random() * 5;
      State.addResource('flightData', dataAmount);
      gained.flightData = dataAmount;

      // Gain a small sample of the destination's resources
      if (destConfig && destConfig.baseYield) {
        for (const [res, baseRate] of Object.entries(destConfig.baseYield)) {
          const amount = baseRate * (0.5 + Math.random() * 1.5);
          const max = State.getStorageMax(res);
          const current = State.getResource(res);
          const canAdd = Math.min(amount, max - current);
          if (canAdd > 0.01) {
            State.addResource(res, canAdd);
            gained[res] = canAdd;
          }
        }
      }

      UI.showNotification(`📡 Probe returned from ${destConfig?.name || mission.to}!`, 'success');
      UI.showTestMissionResult(mission.to, gained);
      UI.render();

    } else if (mission.purpose === 'travel') {
      // Crewed mission: move player to new location
      state.currentLocation = mission.to;
      State.visitLocation(mission.to);

      const locConfig = CONFIG.LOCATIONS[mission.to];
      State.setGameStage('in_space');

      UI.showNotification(`🚀 Arrived at ${locConfig.name}!`, 'success');
      UI.showArrival(mission.to);
      UI.render();
    }
  }

  function checkTabUnlocks() {
    // Build tab: unlocks when solar_panels researched (enables auto-miners)
    if (State.hasResearched('solar_panels') || State.hasResearched('base_construction')) {
      if (State.unlockTab('build')) {
        UI.showNotification('🔓 BUILD tab unlocked — construct buildings!', 'success');
        UI.applyTabLocks();
      }
    }

    // Launch tab: unlocks when chemical_rockets researched
    if (State.hasResearched('chemical_rockets')) {
      if (State.unlockTab('launch')) {
        UI.showNotification('🚀 LAUNCH tab unlocked — build and launch rockets!', 'success');
        UI.applyTabLocks();
      }
    }

    // Map tab: unlocks after first mission completed
    const state = State.get();
    if (state.stats.totalLaunches > 0) {
      if (State.unlockTab('map')) {
        UI.showNotification('🗺 MAP tab unlocked — chart your journey!', 'success');
        UI.applyTabLocks();
      }
    }
  }

  function checkSecrets() {
    const state = State.get();

    for (const [secretId, secret] of Object.entries(CONFIG.SECRETS)) {
      if (state.secretsFound.includes(secretId)) continue;

      const locData = state.locations[secret.location];
      if (!locData || !locData.visited) continue;
      if (!locData.signalArrayBuilt) continue;
      if (locData.secretTriggered) continue;

      // Check trigger
      const resourceMined = locData.totalMined[secret.trigger.replace('_mined', '')] || 0;
      if (resourceMined >= secret.threshold) {
        locData.secretTriggered = true;
        triggerSecret(secretId, secret);
      }
    }
  }

  function triggerSecret(secretId, secret) {
    const state = State.get();
    state.secretsFound.push(secretId);
    state.stats.secretsFound++;

    // Unlock techs
    for (const techId of (secret.unlockTechs || [])) {
      State.unlockTech(techId);
      if (!State.hasResearched(techId)) {
        // Remove from locked state
        CONFIG.TECHS[techId].locked = false;
      }
    }

    // Grant reward resources
    if (secret.reward) {
      for (const [res, amount] of Object.entries(secret.reward)) {
        State.addResource(res, amount);
      }
    }

    // Show dramatic reveal
    UI.showSecretReveal(secretId, secret);
  }

  function checkAchievements() {
    const state = State.get();

    for (const ach of CONFIG.ACHIEVEMENTS) {
      if (State.hasAchievement(ach.id)) continue;

      let earned = false;
      switch (ach.trigger) {
        case 'totalMined':
          earned = state.stats.totalMined >= ach.value;
          break;
        case 'singleResource':
          earned = Object.values(state.resources).some(v => v >= ach.value);
          break;
        case 'location':
          earned = state.locations[ach.value] && state.locations[ach.value].visited;
          break;
        case 'basesBuilt':
          earned = state.stats.basesBuilt >= ach.value;
          break;
        case 'basesCount':
          earned = Object.values(state.locations).filter(l => l.baseBuilt).length >= ach.value;
          break;
        case 'tech':
          earned = State.hasResearched(ach.value);
          break;
        case 'secret':
          earned = state.secretsFound.includes(ach.value);
          break;
      }

      if (earned) {
        if (State.grantAchievement(ach.id)) {
          UI.showAchievement(ach);
        }
      }
    }
  }

  // Offline progress calculation
  function calculateOfflineProgress() {
    const state = State.get();
    const now = Date.now();
    const offlineSeconds = Math.min((now - state.lastSave) / 1000, 3600); // Max 1 hour

    if (offlineSeconds < 5) return;

    let totalGained = {};

    // Calculate what bases would have produced
    for (const [locId, locData] of Object.entries(state.locations)) {
      if (!locData.baseBuilt) continue;

      const production = State.getLocationProduction(locId);
      for (const [res, ratePerSec] of Object.entries(production)) {
        if (!totalGained[res]) totalGained[res] = 0;
        totalGained[res] += ratePerSec * offlineSeconds * 0.5; // 50% offline efficiency
      }
    }

    // Apply gained resources
    let anyGained = false;
    for (const [res, amount] of Object.entries(totalGained)) {
      if (amount > 0.1) {
        const max = State.getStorageMax(res);
        const current = State.getResource(res);
        const canAdd = Math.min(amount, max - current);
        if (canAdd > 0) {
          State.addResource(res, canAdd);
          anyGained = true;
        }
      }
    }

    if (anyGained) {
      const minutes = Math.floor(offlineSeconds / 60);
      const secs = Math.floor(offlineSeconds % 60);
      const timeStr = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
      UI.showOfflineProgress(totalGained, timeStr);
    }
  }

  return {
    start, stop, tick,
    calculateOfflineProgress,
    triggerSecret,
  };
})();

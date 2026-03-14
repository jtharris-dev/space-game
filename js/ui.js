// ============================================================
// COSMIC FRONTIER - UI System
// All rendering, animations, and DOM management
// ============================================================

const UI = (() => {
  let activeTab = 'base';
  let secretRevealActive = false;
  let particleContainer = null;
  let lastRenderTime = 0;

  // ---- INIT ----
  function init() {
    particleContainer = document.getElementById('particles');
    bindTabNav();
    bindKeyboard();
    createStarfield();
    render();
  }

  function bindTabNav() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.key === '1') switchTab('base');
      if (e.key === '2') switchTab('research');
      if (e.key === '3') switchTab('build');
      if (e.key === '4') switchTab('launch');
      if (e.key === '5') switchTab('map');
      if (e.key === '6') switchTab('log');
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(el => {
      el.classList.toggle('active', el.id === `tab-${tab}`);
    });
    render();
  }

  // ---- MAIN RENDER ----
  function render() {
    renderHeader();
    renderResources();
    switch (activeTab) {
      case 'base': renderBase(); break;
      case 'research': renderResearch(); break;
      case 'build': renderBuild(); break;
      case 'launch': renderLaunch(); break;
      case 'map': renderMap(); break;
      case 'log': renderLog(); break;
    }
  }

  function tick(dt) {
    const now = Date.now();
    if (now - lastRenderTime > 500) { // Update UI at 2fps for efficiency
      renderResources();
      renderMissionProgress();
      renderResearchProgress();
      lastRenderTime = now;
    }
  }

  // ---- HEADER ----
  function renderHeader() {
    const state = State.get();
    const locId = state.currentLocation;
    const locConfig = CONFIG.LOCATIONS[locId];
    const locData = State.getLocation(locId);

    const el = document.getElementById('location-header');
    if (!el) return;

    const distStr = locConfig.distance === 0 ? 'Home World' :
      `${locConfig.distance} ${locConfig.distanceUnit || 'AU'} from Sun`;

    el.innerHTML = `
      <div class="location-badge" style="border-color: ${locConfig.color}">
        <span class="location-icon">${locConfig.icon}</span>
        <div class="location-info">
          <div class="location-name">${locConfig.name}</div>
          <div class="location-dist">${distStr}</div>
        </div>
        ${locData.baseBuilt ? '<span class="base-indicator">⚡ BASE</span>' : ''}
      </div>
      ${renderMissionProgressInline()}
    `;
  }

  function renderMissionProgressInline() {
    const mission = Actions.getMissionProgress();
    if (!mission) return '';
    const pct = Math.floor(mission.progress * 100);
    const dest = CONFIG.LOCATIONS[mission.to];
    return `
      <div class="mission-inline">
        <div class="mission-label">🚀 En route to ${dest ? dest.name : mission.to} — ${Actions.formatTime(mission.remaining)}</div>
        <div class="mission-bar-wrap"><div class="mission-bar" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  // ---- RESOURCES ----
  function renderResources() {
    const state = State.get();
    const locConfig = CONFIG.LOCATIONS[state.currentLocation];
    const container = document.getElementById('resources-bar');
    if (!container) return;

    const production = State.getLocationProduction(state.currentLocation);

    const knownResources = locConfig.resources || [];
    // Also show resources player has from other locations
    const allResources = new Set([...knownResources, ...Object.keys(state.resources).filter(r => state.resources[r] > 0)]);

    let html = '';
    for (const resId of allResources) {
      const amount = State.getResource(resId);
      if (amount < 0.01 && !knownResources.includes(resId)) continue;
      const resDef = CONFIG.RESOURCES[resId];
      if (!resDef) continue;

      const max = State.getStorageMax(resId);
      const pct = Math.min(100, (amount / max) * 100);
      const rate = production[resId] || 0;
      const rateStr = rate > 0 ? `<span class="res-rate">+${Actions.formatNumber(rate)}/s</span>` : '';

      html += `
        <div class="resource-chip" title="${resDef.desc}" style="--res-color: ${resDef.color}">
          <span class="res-icon">${resDef.icon}</span>
          <div class="res-details">
            <div class="res-name">${resDef.name}</div>
            <div class="res-amount">${Actions.formatNumber(amount)} ${rateStr}</div>
            <div class="res-bar-bg"><div class="res-bar-fill" style="width:${pct}%;background:${resDef.color}"></div></div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html || '<div class="no-resources">No resources yet. Start mining!</div>';
  }

  // ---- BASE TAB ----
  function renderBase() {
    const state = State.get();
    const locId = state.currentLocation;
    const locConfig = CONFIG.LOCATIONS[locId];
    const locData = State.getLocation(locId);

    const container = document.getElementById('tab-base');

    const autoMinerCount = State.getBuildingCount(locId, 'auto_miner');
    const production = State.getLocationProduction(locId);
    const hasAutoMine = State.hasResearched('solar_panels');

    let prodStr = '';
    if (locData.baseBuilt && Object.keys(production).length > 0) {
      prodStr = Object.entries(production)
        .filter(([,v]) => v > 0)
        .map(([r, v]) => {
          const def = CONFIG.RESOURCES[r];
          return `${def ? def.icon : ''} +${Actions.formatNumber(v)}/s`;
        }).join('  ');
    }

    container.innerHTML = `
      <div class="base-view">
        <div class="planet-visual">
          ${renderPlanet(locId)}
        </div>
        <div class="location-desc">${locConfig.description}</div>
        <div class="flavor-text">"${locConfig.flavorText}"</div>

        <div class="available-resources">
          <h3>Available Resources</h3>
          <div class="resource-tags">
            ${locConfig.resources.map(r => {
              const def = CONFIG.RESOURCES[r];
              return def ? `<span class="res-tag" style="border-color:${def.color}">${def.icon} ${def.name}</span>` : '';
            }).join('')}
          </div>
        </div>

        <button class="mine-btn" id="mine-btn" onclick="onMineClick()">
          <span class="mine-icon">⛏</span>
          <span class="mine-text">MINE</span>
          <span class="mine-sub">tap to extract resources</span>
        </button>

        ${locData.baseBuilt && prodStr ? `
          <div class="auto-prod">
            <span class="auto-label">⚡ Auto-production:</span>
            <span class="auto-rates">${prodStr}</span>
          </div>
        ` : ''}

        ${!locData.baseBuilt && hasAutoMine ? `
          <div class="hint-box">💡 Build a <strong>Base Module</strong> in the Build tab to enable auto-mining here.</div>
        ` : ''}

        ${locData.secretTriggered ? `
          <div class="secret-banner">
            📡 <strong>Signal Detected & Analyzed</strong> — New technologies unlocked!
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderPlanet(locId) {
    const loc = CONFIG.LOCATIONS[locId];
    const hasRing = loc.ringColor;

    let planet = `
      <div class="planet-container">
        ${hasRing ? `<div class="planet-ring" style="border-color:${loc.ringColor}"></div>` : ''}
        <div class="planet-sphere" style="background: radial-gradient(circle at 35% 35%, ${lighten(loc.color, 40)}, ${loc.color}, ${darken(loc.color, 30)})">
          <div class="planet-atmosphere" style="box-shadow: 0 0 30px ${loc.color}66, 0 0 60px ${loc.color}33"></div>
        </div>
      </div>
    `;
    return planet;
  }

  // ---- RESEARCH TAB ----
  function renderResearch() {
    const state = State.get();
    const container = document.getElementById('tab-research');
    if (!container) return;

    const tiers = {};
    for (const [techId, tech] of Object.entries(CONFIG.TECHS)) {
      if (!tiers[tech.tier]) tiers[tech.tier] = [];
      tiers[tech.tier].push({ id: techId, ...tech });
    }

    const tierNames = {
      0: '🌍 Earth Foundation',
      1: '🌙 Inner Solar System',
      2: '🪐 Outer Solar System',
      3: '🌀 Quantum Era',
      4: '⭐ Interstellar',
      5: '◈ Void Science',
    };

    let html = '';
    const resProgress = Actions.getResearchProgress();

    // Active research bar
    if (resProgress) {
      const pct = Math.floor(resProgress.progress * 100);
      html += `
        <div class="active-research">
          <div class="ar-header">
            <span>🔬 Researching: <strong>${resProgress.tech.name}</strong></span>
            <span>${Actions.formatTime(resProgress.remaining)}</span>
          </div>
          <div class="ar-bar-bg"><div class="ar-bar-fill" style="width:${pct}%"></div></div>
          <button class="cancel-btn" onclick="Actions.cancelResearch()">Cancel (50% refund)</button>
        </div>
      `;
    }

    // Research queue
    if (state.research.queue.length > 0) {
      html += `<div class="research-queue">
        <span>📋 Queue: </span>
        ${state.research.queue.map(tid => {
          const t = CONFIG.TECHS[tid];
          return t ? `<span class="queue-item">${t.name}</span>` : '';
        }).join(' → ')}
      </div>`;
    }

    // Tech tiers
    for (const [tier, techs] of Object.entries(tiers).sort((a,b) => a[0]-b[0])) {
      const anyVisible = techs.some(t => !t.locked || state.secretsFound.length > 0);
      if (!anyVisible) continue;

      html += `<div class="tech-tier">
        <h3 class="tier-title">${tierNames[tier] || `Tier ${tier}`}</h3>
        <div class="tech-grid">`;

      for (const tech of techs) {
        html += renderTechCard(tech, state, resProgress);
      }

      html += `</div></div>`;
    }

    container.innerHTML = html;
  }

  function renderTechCard(tech, state, resProgress) {
    const done = State.hasResearched(tech.id);
    const active = resProgress && resProgress.techId === tech.id;
    const locked = tech.locked;

    if (locked && !state.secretsFound.some(s => {
      const secret = CONFIG.SECRETS[s];
      return secret && secret.unlockTechs && secret.unlockTechs.includes(tech.id);
    })) {
      // Show redacted card for locked techs (only partially)
      return `
        <div class="tech-card locked">
          <div class="tech-icon">🔒</div>
          <div class="tech-name">[ CLASSIFIED ]</div>
          <div class="tech-desc">Requires special discovery to unlock.</div>
        </div>
      `;
    }

    const prereqsMet = (tech.requires || []).every(r => State.hasResearched(r));
    const canAfford = State.canAfford(tech.cost || {});
    const canResearch = prereqsMet && canAfford && !done && !active && !state.research.active;

    let costHtml = '';
    if (!done && tech.cost) {
      costHtml = Object.entries(tech.cost).map(([r, amt]) => {
        const def = CONFIG.RESOURCES[r];
        const have = State.getResource(r);
        const enough = have >= amt;
        return `<span class="cost-item ${enough ? 'ok' : 'short'}">
          ${def ? def.icon : r} ${Actions.formatNumber(amt)}
        </span>`;
      }).join('');
    }

    const unlocksHtml = tech.unlocks && tech.unlocks.length > 0
      ? `<div class="tech-unlocks">Unlocks: ${tech.unlocks.map(u => {
          const rocket = CONFIG.ROCKETS[u];
          const building = CONFIG.BUILDINGS[u];
          return rocket ? `🚀 ${rocket.name}` : building ? `🏗 ${building.name}` : u;
        }).join(', ')}</div>`
      : '';

    return `
      <div class="tech-card ${done ? 'done' : ''} ${active ? 'active' : ''} ${!prereqsMet ? 'blocked' : ''}">
        <div class="tech-icon">${tech.icon}</div>
        <div class="tech-name">${tech.name}</div>
        <div class="tech-desc">${tech.desc}</div>
        ${unlocksHtml}
        ${done ? '<div class="tech-status done-badge">✅ Researched</div>' :
          active ? `<div class="tech-status active-badge">🔬 In Progress</div>` :
          !prereqsMet ? '<div class="tech-status blocked-badge">🔒 Locked</div>' :
          `<div class="tech-cost">${costHtml}</div>
           <button class="research-btn ${canResearch ? '' : 'disabled'}"
             onclick="onResearchClick('${tech.id}')"
             ${canResearch ? '' : 'disabled'}>
             Research (${Actions.formatTime(tech.researchTime)})
           </button>`
        }
      </div>
    `;
  }

  function renderResearchProgress() {
    const progress = Actions.getResearchProgress();
    if (!progress) return;

    const el = document.querySelector('.ar-bar-fill');
    if (el) el.style.width = Math.floor(progress.progress * 100) + '%';

    const timeEl = document.querySelector('.active-research .ar-header span:last-child');
    if (timeEl) timeEl.textContent = Actions.formatTime(progress.remaining);
  }

  // ---- BUILD TAB ----
  function renderBuild() {
    const state = State.get();
    const locId = state.currentLocation;
    const locConfig = CONFIG.LOCATIONS[locId];
    const locData = State.getLocation(locId);
    const container = document.getElementById('tab-build');

    let html = `<div class="build-view">
      <h3>Buildings on ${locConfig.name}</h3>
    `;

    // Show existing buildings
    const existing = locData.buildings;
    if (Object.keys(existing).length > 0) {
      html += '<div class="existing-buildings">';
      for (const [bId, count] of Object.entries(existing)) {
        const bDef = CONFIG.BUILDINGS[bId];
        if (!bDef || count === 0) continue;
        html += `
          <div class="building-existing">
            <span>${bDef.icon} ${bDef.name}</span>
            <span class="building-count">×${count}</span>
          </div>
        `;
      }
      html += '</div>';
    }

    html += '<h3>Available Buildings</h3><div class="build-grid">';

    for (const [bId, bDef] of Object.entries(CONFIG.BUILDINGS)) {
      html += renderBuildCard(locId, bId, bDef, locData, state);
    }

    html += '</div></div>';
    container.innerHTML = html;
  }

  function renderBuildCard(locId, bId, bDef, locData, state) {
    const isResearched = State.hasResearched(bDef.requires);
    const count = State.getBuildingCount(locId, bId);
    const maxed = bDef.maxPerLocation && count >= bDef.maxPerLocation;
    const needsBase = bDef.requiresBase && !locData.baseBuilt;
    const cost = Actions.getBuildingCostNext(locId, bId);
    const canAfford = State.canAfford(cost);

    if (!isResearched) {
      return `
        <div class="build-card locked">
          <div class="build-icon">🔒</div>
          <div class="build-name">${bDef.name}</div>
          <div class="build-req">Requires: ${CONFIG.TECHS[bDef.requires]?.name || bDef.requires}</div>
        </div>
      `;
    }

    const costHtml = Object.entries(cost).map(([r, amt]) => {
      const def = CONFIG.RESOURCES[r];
      const have = State.getResource(r);
      const ok = have >= amt;
      return `<span class="cost-item ${ok ? 'ok' : 'short'}">${def ? def.icon : r} ${Actions.formatNumber(amt)}</span>`;
    }).join('');

    const canBuild = canAfford && !maxed && !needsBase;

    return `
      <div class="build-card ${maxed ? 'maxed' : ''} ${needsBase ? 'blocked' : ''}">
        <div class="build-icon">${bDef.icon}</div>
        <div class="build-name">${bDef.name} ${count > 0 ? `<span class="count-badge">×${count}</span>` : ''}</div>
        <div class="build-desc">${bDef.desc}</div>
        ${maxed ? '<div class="maxed-label">MAX</div>' :
          needsBase ? '<div class="blocked-label">Requires Base Module</div>' :
          `<div class="build-cost">${costHtml}</div>
           <button class="build-btn ${canBuild ? '' : 'disabled'}"
             onclick="onBuildClick('${bId}')"
             ${canBuild ? '' : 'disabled'}>
             Build ${bDef.maxPerLocation ? `(${count}/${bDef.maxPerLocation})` : ''}
           </button>`
        }
      </div>
    `;
  }

  // ---- LAUNCH TAB ----
  function renderLaunch() {
    const state = State.get();
    const container = document.getElementById('tab-launch');
    if (!container) return;

    const mission = Actions.getMissionProgress();

    let html = '';

    // Active mission display
    if (mission) {
      const dest = CONFIG.LOCATIONS[mission.to];
      const pct = Math.floor(mission.progress * 100);
      html += `
        <div class="active-mission">
          <div class="mission-title">🚀 ACTIVE MISSION</div>
          <div class="mission-detail">
            <span>${CONFIG.LOCATIONS[mission.from]?.icon} ${CONFIG.LOCATIONS[mission.from]?.name}</span>
            <span class="mission-arrow">→→→</span>
            <span>${dest?.icon} ${dest?.name}</span>
          </div>
          <div class="mission-rocket">${CONFIG.ROCKETS[mission.rocketId]?.icon || '🚀'} ${mission.rocketName}</div>
          <div class="mission-time">ETA: ${Actions.formatTime(mission.remaining)}</div>
          <div class="mission-bar-wrap big">
            <div class="mission-bar" style="width:${pct}%">
              <div class="thruster-glow"></div>
            </div>
          </div>
        </div>
      `;
    }

    // Hangar
    html += '<div class="hangar-section"><h3>🏭 Hangar</h3>';
    if (state.hangar.length === 0) {
      html += '<p class="empty-hint">No rockets in hangar. Build one below!</p>';
    } else {
      html += '<div class="hangar-list">';
      for (const entry of state.hangar) {
        const rDef = CONFIG.ROCKETS[entry.rocketId];
        html += `
          <div class="hangar-entry">
            <div class="rocket-display">
              <span class="rocket-icon-lg">${rDef.icon}</span>
              <div>
                <div class="rocket-name">${rDef.name}</div>
                <div class="rocket-desc">${rDef.desc}</div>
              </div>
            </div>
            <div class="launch-targets">
              ${renderLaunchTargets(entry, rDef, state)}
            </div>
          </div>
        `;
      }
      html += '</div>';
    }
    html += '</div>';

    // Build rocket section
    html += '<div class="build-rockets"><h3>🚀 Build Rockets</h3><div class="rocket-grid">';
    for (const [rId, rDef] of Object.entries(CONFIG.ROCKETS)) {
      html += renderRocketCard(rId, rDef, state);
    }
    html += '</div></div>';

    container.innerHTML = html;
  }

  function renderLaunchTargets(entry, rDef, state) {
    const currentLoc = state.currentLocation;
    const allLocs = rDef.range === null
      ? Object.keys(CONFIG.LOCATIONS)
      : (rDef.range || []);

    return allLocs
      .filter(locId => locId !== currentLoc && CONFIG.LOCATIONS[locId]?.unlocked)
      .map(locId => {
        const lDef = CONFIG.LOCATIONS[locId];
        const disabled = !!state.activeMission;
        return `
          <button class="launch-target-btn ${disabled ? 'disabled' : ''}"
            onclick="onLaunchClick(${entry.id}, '${locId}')"
            ${disabled ? 'disabled' : ''}>
            ${lDef.icon} ${lDef.name}
          </button>
        `;
      }).join('') || '<span class="no-targets">No reachable destinations</span>';
  }

  function renderRocketCard(rId, rDef, state) {
    const isUnlocked = State.hasResearched(rDef.requires);
    if (!isUnlocked) {
      return `
        <div class="rocket-card locked">
          <div class="rocket-icon">${rDef.icon}</div>
          <div class="rocket-name">${rDef.name}</div>
          <div class="rocket-req">Requires: ${CONFIG.TECHS[rDef.requires]?.name || rDef.requires}</div>
        </div>
      `;
    }

    const canAfford = State.canAfford(rDef.cost);
    const costHtml = Object.entries(rDef.cost).map(([r, amt]) => {
      const def = CONFIG.RESOURCES[r];
      const have = State.getResource(r);
      const ok = have >= amt;
      return `<span class="cost-item ${ok ? 'ok' : 'short'}">${def ? def.icon : r} ${Actions.formatNumber(amt)}</span>`;
    }).join('');

    return `
      <div class="rocket-card">
        <div class="rocket-icon">${rDef.icon}</div>
        <div class="rocket-name">${rDef.name}</div>
        <div class="rocket-tier">Tier ${rDef.tier}</div>
        <div class="rocket-desc">${rDef.desc}</div>
        <div class="rocket-cost">${costHtml}</div>
        <button class="build-rocket-btn ${canAfford ? '' : 'disabled'}"
          onclick="onBuildRocketClick('${rId}')"
          ${canAfford ? '' : 'disabled'}>
          Build Rocket
        </button>
      </div>
    `;
  }

  function renderMissionProgress() {
    const mission = Actions.getMissionProgress();
    const missionBar = document.querySelector('.active-mission .mission-bar');
    const missionTime = document.querySelector('.active-mission .mission-time');

    if (mission && missionBar) {
      missionBar.style.width = Math.floor(mission.progress * 100) + '%';
    }
    if (mission && missionTime) {
      missionTime.textContent = `ETA: ${Actions.formatTime(mission.remaining)}`;
    }

    // Update inline header mission
    const inlineMission = document.querySelector('.mission-inline');
    if (mission && !inlineMission) {
      renderHeader();
    } else if (!mission && inlineMission) {
      renderHeader();
    } else if (mission && inlineMission) {
      const barEl = inlineMission.querySelector('.mission-bar');
      const labelEl = inlineMission.querySelector('.mission-label');
      if (barEl) barEl.style.width = Math.floor(mission.progress * 100) + '%';
      if (labelEl) {
        const dest = CONFIG.LOCATIONS[mission.to];
        labelEl.textContent = `🚀 En route to ${dest ? dest.name : mission.to} — ${Actions.formatTime(mission.remaining)}`;
      }
    }
  }

  // ---- MAP TAB ----
  function renderMap() {
    const state = State.get();
    const container = document.getElementById('tab-map');

    const groups = [
      { label: '🌍 Earth System', locs: ['earth', 'moon'] },
      { label: '🔴 Inner Solar System', locs: ['mars', 'asteroidBelt'] },
      { label: '🟠 Outer Solar System', locs: ['jupiter', 'europa', 'saturn', 'titan', 'uranus', 'neptune'] },
      { label: '🌌 Kuiper & Beyond', locs: ['kuiperBelt'] },
      { label: '⭐ Nearby Stars', locs: ['proxima', 'proximaB', 'alphaCentauri'] },
      { label: '◈ Void Space', locs: ['voidNexus'] },
    ];

    let html = '<div class="galaxy-map">';

    for (const group of groups) {
      const visible = group.locs.some(id => {
        const loc = CONFIG.LOCATIONS[id];
        return loc && (loc.unlocked || State.getLocation(id).visited);
      });
      if (!visible) continue;

      html += `<div class="map-group"><h3 class="map-group-title">${group.label}</h3><div class="map-nodes">`;

      for (const locId of group.locs) {
        const locConfig = CONFIG.LOCATIONS[locId];
        if (!locConfig) continue;

        const locData = State.getLocation(locId);
        const isCurrentLocation = locId === state.currentLocation;
        const isVisited = locData.visited;
        const isUnlocked = locConfig.unlocked;
        const isSecret = locConfig.secret;

        if (!isUnlocked && !isVisited) {
          html += `
            <div class="map-node unknown">
              <div class="map-node-icon">❓</div>
              <div class="map-node-name">???</div>
              <div class="map-node-status">Not yet discovered</div>
            </div>
          `;
          continue;
        }

        html += `
          <div class="map-node ${isCurrentLocation ? 'current' : ''} ${isVisited ? 'visited' : ''}"
            style="--loc-color: ${locConfig.color}"
            onclick="onMapNodeClick('${locId}')">
            <div class="map-node-icon">${locConfig.icon}</div>
            <div class="map-node-name">${locConfig.name}</div>
            <div class="map-node-dist">${locConfig.distance} ${locConfig.distanceUnit || 'AU'}</div>
            ${isCurrentLocation ? '<div class="here-badge">YOU ARE HERE</div>' : ''}
            ${locData.baseBuilt ? '<div class="base-badge">⚡ Base</div>' : ''}
            ${locData.secretTriggered ? '<div class="secret-badge">📡 Signal</div>' : ''}
          </div>
        `;
      }

      html += '</div></div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  // ---- LOG TAB ----
  function renderLog() {
    const state = State.get();
    const container = document.getElementById('tab-log');

    const hours = Math.floor(state.stats.playTime / 3600);
    const mins = Math.floor((state.stats.playTime % 3600) / 60);
    const secs = Math.floor(state.stats.playTime % 60);

    let html = `
      <div class="log-view">
        <div class="stats-panel">
          <h3>📊 Mission Statistics</h3>
          <div class="stats-grid">
            <div class="stat-item"><span>⏱ Play Time</span><span>${hours}h ${mins}m ${secs}s</span></div>
            <div class="stat-item"><span>⛏ Total Mined</span><span>${Actions.formatNumber(state.stats.totalMined)}</span></div>
            <div class="stat-item"><span>🚀 Launches</span><span>${state.stats.totalLaunches}</span></div>
            <div class="stat-item"><span>🔬 Researched</span><span>${state.stats.totalResearched}</span></div>
            <div class="stat-item"><span>🏗 Bases Built</span><span>${state.stats.basesBuilt}</span></div>
            <div class="stat-item"><span>🌍 Locations Visited</span><span>${state.stats.locationsVisited}</span></div>
            <div class="stat-item"><span>📡 Secrets Found</span><span>${state.stats.secretsFound}</span></div>
          </div>
        </div>

        <div class="achievements-panel">
          <h3>🏆 Achievements (${state.achievements.length}/${CONFIG.ACHIEVEMENTS.length})</h3>
          <div class="achievement-list">
            ${CONFIG.ACHIEVEMENTS.map(ach => {
              const earned = State.hasAchievement(ach.id);
              return `
                <div class="achievement ${earned ? 'earned' : 'locked'}">
                  <span class="ach-icon">${ach.icon}</span>
                  <div class="ach-info">
                    <div class="ach-name">${ach.name}</div>
                    <div class="ach-desc">${earned ? ach.desc : '???'}</div>
                  </div>
                  ${earned ? '<span class="ach-check">✅</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="save-panel">
          <button class="save-btn" onclick="State.save(); UI.showNotification('Game saved!', 'success')">💾 Save Game</button>
          <button class="reset-btn" onclick="onResetGame()">🗑 Reset Game</button>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ---- NOTIFICATIONS ----
  function showNotification(msg, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = msg;
    container.appendChild(el);

    // Animate in
    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, CONFIG.SETTINGS.notificationDuration);
  }

  function showAchievement(ach) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'notification achievement-popup';
    el.innerHTML = `
      <div class="ach-popup-inner">
        <span class="ach-popup-icon">${ach.icon}</span>
        <div>
          <div class="ach-popup-title">Achievement Unlocked!</div>
          <div class="ach-popup-name">${ach.name}</div>
          <div class="ach-popup-desc">${ach.desc}</div>
        </div>
      </div>
    `;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 5000);
  }

  // ---- MINE CLICK EFFECT ----
  function showMineEffect(gained) {
    const btn = document.getElementById('mine-btn');
    if (!btn) return;

    btn.classList.add('mining');
    setTimeout(() => btn.classList.remove('mining'), 150);

    // Floating text for each resource
    for (const [resId, amount] of Object.entries(gained)) {
      if (amount < 0.01) continue;
      const def = CONFIG.RESOURCES[resId];
      if (!def) continue;

      const el = document.createElement('div');
      el.className = 'float-text';
      el.style.color = def.color;

      const rect = btn.getBoundingClientRect();
      el.style.left = (rect.left + Math.random() * rect.width) + 'px';
      el.style.top = (rect.top - 10) + 'px';
      el.textContent = `${def.icon} +${Actions.formatNumber(amount)}`;
      document.body.appendChild(el);

      requestAnimationFrame(() => el.classList.add('float-up'));
      setTimeout(() => el.remove(), 1200);
    }

    // Particles
    spawnParticles(btn);
  }

  function spawnParticles(target) {
    if (!particleContainer) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (let i = 0; i < CONFIG.SETTINGS.clickParticles; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const angle = (Math.PI * 2 / CONFIG.SETTINGS.clickParticles) * i;
      const dist = 30 + Math.random() * 40;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--tx', tx + 'px');
      p.style.setProperty('--ty', ty + 'px');
      particleContainer.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  // ---- DISCOVERY REVEAL ----
  function showDiscovery(techId) {
    const tech = CONFIG.TECHS[techId];
    if (!tech) return;

    const unlockLoc = tech.unlockLocation;
    if (!unlockLoc) return;

    const loc = CONFIG.LOCATIONS[unlockLoc];
    if (!loc) return;

    showNotification(`🔓 New location unlocked: ${loc.icon} ${loc.name}`, 'success');
  }

  // ---- SECRET REVEAL ----
  function showSecretReveal(secretId, secret) {
    if (secretRevealActive) return;
    secretRevealActive = true;

    const overlay = document.getElementById('secret-overlay');
    const contentEl = document.getElementById('secret-content');

    overlay.classList.add('active');
    contentEl.innerHTML = `
      <div class="secret-title">${secret.title}</div>
      <div class="secret-messages" id="secret-messages"></div>
      <button class="secret-close-btn" id="secret-close" style="display:none"
        onclick="UI.closeSecretReveal()">
        ACKNOWLEDGE ✓
      </button>
    `;

    const msgContainer = document.getElementById('secret-messages');
    let msgIndex = 0;

    function showNextMessage() {
      if (msgIndex >= secret.messages.length) {
        document.getElementById('secret-close').style.display = 'block';
        return;
      }

      const msgEl = document.createElement('div');
      msgEl.className = 'secret-message';
      msgEl.textContent = secret.messages[msgIndex];
      msgContainer.appendChild(msgEl);

      requestAnimationFrame(() => msgEl.classList.add('show'));

      msgIndex++;
      setTimeout(showNextMessage, 1800);
    }

    setTimeout(showNextMessage, 500);
  }

  function closeSecretReveal() {
    const overlay = document.getElementById('secret-overlay');
    overlay.classList.remove('active');
    secretRevealActive = false;
    render();
  }

  // ---- ARRIVAL REVEAL ----
  function showArrival(locId) {
    const loc = CONFIG.LOCATIONS[locId];
    if (!loc) return;

    const overlay = document.getElementById('arrival-overlay');
    const contentEl = document.getElementById('arrival-content');

    overlay.classList.add('active');
    contentEl.innerHTML = `
      <div class="arrival-icon">${loc.icon}</div>
      <div class="arrival-name">Arrived at ${loc.name}</div>
      <div class="arrival-dist">${loc.distance} ${loc.distanceUnit || 'AU'} from the Sun</div>
      <div class="arrival-flavor">"${loc.flavorText}"</div>
      <div class="arrival-resources">
        Available resources: ${loc.resources.map(r => {
          const def = CONFIG.RESOURCES[r];
          return def ? `${def.icon} ${def.name}` : r;
        }).join(' · ')}
      </div>
      <button onclick="UI.closeArrival()">Begin Exploration</button>
    `;

    setTimeout(() => overlay.classList.remove('active'), 6000);
  }

  function closeArrival() {
    document.getElementById('arrival-overlay').classList.remove('active');
    switchTab('base');
  }

  // ---- OFFLINE PROGRESS ----
  function showOfflineProgress(gained, timeStr) {
    const overlay = document.getElementById('offline-overlay');
    const contentEl = document.getElementById('offline-content');

    const gainedList = Object.entries(gained)
      .filter(([,v]) => v > 0.1)
      .map(([r, v]) => {
        const def = CONFIG.RESOURCES[r];
        return `<div class="offline-resource">
          ${def ? def.icon : r} ${def ? def.name : r}: +${Actions.formatNumber(v)}
        </div>`;
      }).join('');

    if (!gainedList) return;

    contentEl.innerHTML = `
      <div class="offline-title">⏰ Welcome Back!</div>
      <div class="offline-time">You were away for ${timeStr}</div>
      <div class="offline-subtitle">Your bases produced while you were gone:</div>
      <div class="offline-resources">${gainedList}</div>
      <button onclick="document.getElementById('offline-overlay').classList.remove('active')">Continue</button>
    `;

    overlay.classList.add('active');
  }

  // ---- STARFIELD ----
  function createStarfield() {
    const canvas = document.getElementById('starfield');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const stars = [];
    const numStars = 200;

    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        alpha: Math.random() * 0.8 + 0.2,
        speed: Math.random() * 0.3 + 0.05,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }

    let animFrame;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = Date.now() / 1000;

      for (const star of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * star.twinkleSpeed * 100 + star.twinkleOffset);
        ctx.globalAlpha = star.alpha * (0.5 + twinkle * 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animFrame = requestAnimationFrame(draw);
    }

    draw();

    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }

  // ---- COLOR UTILS ----
  function lighten(hex, amount) {
    return adjustColor(hex, amount);
  }

  function darken(hex, amount) {
    return adjustColor(hex, -amount);
  }

  function adjustColor(hex, amount) {
    const clamp = v => Math.min(255, Math.max(0, v));
    let r, g, b;
    if (hex.startsWith('#')) {
      const n = parseInt(hex.slice(1), 16);
      r = (n >> 16) & 0xff;
      g = (n >> 8) & 0xff;
      b = n & 0xff;
    } else {
      return hex;
    }
    r = clamp(r + amount);
    g = clamp(g + amount);
    b = clamp(b + amount);
    return `rgb(${r},${g},${b})`;
  }

  // ---- MAP NODE CLICK ----
  function onMapNodeClick(locId) {
    const locConfig = CONFIG.LOCATIONS[locId];
    const locData = State.getLocation(locId);
    if (!locConfig) return;

    showNotification(`${locConfig.icon} ${locConfig.name}: ${locConfig.description}`, 'info');
  }

  return {
    init, render, tick, switchTab,
    showNotification, showAchievement,
    showMineEffect, showDiscovery,
    showSecretReveal, closeSecretReveal,
    showArrival, closeArrival,
    showOfflineProgress,
    renderResearch, renderLaunch,
    onMapNodeClick,
  };
})();

// ---- GLOBAL EVENT HANDLERS (called from inline HTML) ----
function onMineClick() {
  const state = State.get();
  Actions.mine(state.currentLocation);
}

function onResearchClick(techId) {
  const result = Actions.startResearch(techId);
  if (!result.ok) {
    UI.showNotification(`❌ ${result.reason}`, 'error');
  } else {
    UI.renderResearch();
  }
}

function onBuildClick(buildingId) {
  const state = State.get();
  const result = Actions.build(state.currentLocation, buildingId);
  if (!result.ok) {
    UI.showNotification(`❌ ${result.reason}`, 'error');
  }
}

function onBuildRocketClick(rocketId) {
  const result = Actions.buildRocket(rocketId);
  if (!result.ok) {
    UI.showNotification(`❌ ${result.reason}`, 'error');
  }
}

function onLaunchClick(hangarId, destinationId) {
  const result = Actions.launch(hangarId, destinationId);
  if (!result.ok) {
    UI.showNotification(`❌ ${result.reason}`, 'error');
  }
}

function onMapNodeClick(locId) {
  UI.onMapNodeClick(locId);
}

function onResetGame() {
  if (confirm('Reset all progress? This cannot be undone!')) {
    State.reset();
    location.reload();
  }
}

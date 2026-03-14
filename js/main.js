// ============================================================
// COSMIC FRONTIER - Main Entry Point
// Game initialization and startup sequence
// ============================================================

(function () {
  'use strict';

  function init() {
    // Initialize game state (load from storage or create fresh)
    const state = State.init();

    // Apply any tech effects already researched (from loaded save)
    for (const techId of state.research.completed) {
      const tech = CONFIG.TECHS[techId];
      if (!tech) continue;

      // Re-unlock locations
      if (tech.unlockLocation) CONFIG.LOCATIONS[tech.unlockLocation].unlocked = true;
      if (tech.unlockLocationAlt) CONFIG.LOCATIONS[tech.unlockLocationAlt].unlocked = true;
    }

    // Re-apply secret unlocks
    for (const secretId of state.secretsFound) {
      const secret = CONFIG.SECRETS[secretId];
      if (secret && secret.unlockTechs) {
        for (const techId of secret.unlockTechs) {
          State.unlockTech(techId);
        }
      }
    }

    // Initialize UI
    UI.init();

    // Show loading sequence
    showSplash(() => {
      // Calculate offline progress
      Engine.calculateOfflineProgress();

      // Start the game engine
      Engine.start();

      // Tutorial for new players
      if (!state.ui.tutorialDone && state.stats.totalMined === 0) {
        setTimeout(() => showTutorial(), 500);
      }
    });
  }

  function showSplash(callback) {
    const splash = document.getElementById('splash');
    if (!splash) {
      callback();
      return;
    }

    let progress = 0;
    const bar = splash.querySelector('.splash-bar-fill');
    const statusEl = splash.querySelector('.splash-status');

    const steps = [
      'Initializing systems...',
      'Loading star charts...',
      'Calibrating sensors...',
      'Engaging drives...',
      'Ready for launch.',
    ];

    let stepIndex = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 25 + 5;
      if (progress > 100) progress = 100;
      if (bar) bar.style.width = progress + '%';

      const targetStep = Math.floor((progress / 100) * steps.length);
      if (targetStep !== stepIndex && targetStep < steps.length) {
        stepIndex = targetStep;
        if (statusEl) statusEl.textContent = steps[stepIndex];
      }

      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          splash.classList.add('fade-out');
          setTimeout(() => {
            splash.style.display = 'none';
            callback();
          }, 600);
        }, 400);
      }
    }, 120);
  }

  function showTutorial() {
    const state = State.get();
    const steps = [
      {
        title: '👋 Welcome to Cosmic Frontier!',
        text: 'You are humanity\'s first resource director. Start by mining Earth\'s resources to fund your journey to the stars.',
        highlight: '#mine-btn',
      },
      {
        title: '⛏ Mine Resources',
        text: 'Tap the MINE button to extract iron and silicon. These are the foundation of everything you\'ll build.',
        highlight: '#mine-btn',
      },
      {
        title: '🔬 Research Technology',
        text: 'Use the Research tab to unlock new technologies. Start with "Advanced Mining Drills" and "Chemical Rockets".',
        highlight: '[data-tab="research"]',
      },
      {
        title: '🚀 Reach for the Stars',
        text: 'Once you have rocket technology, build a rocket in the Launch tab and blast off to the Moon. The cosmos awaits!',
        highlight: '[data-tab="launch"]',
      },
    ];

    showTutorialStep(0, steps, state);
  }

  function showTutorialStep(index, steps, state) {
    if (index >= steps.length) {
      state.ui.tutorialDone = true;
      return;
    }

    const step = steps[index];
    const tutEl = document.getElementById('tutorial-popup');
    if (!tutEl) return;

    tutEl.innerHTML = `
      <div class="tutorial-inner">
        <div class="tutorial-title">${step.title}</div>
        <div class="tutorial-text">${step.text}</div>
        <div class="tutorial-footer">
          <span>${index + 1} / ${steps.length}</span>
          <button onclick="showNextTutorial(${index + 1}, ${JSON.stringify(steps).replace(/"/g, '&quot;')})">
            ${index === steps.length - 1 ? 'Begin!' : 'Next →'}
          </button>
        </div>
      </div>
    `;
    tutEl.classList.add('show');

    // Highlight target element
    if (step.highlight) {
      const target = document.querySelector(step.highlight);
      if (target) {
        target.classList.add('tutorial-highlight');
        setTimeout(() => target.classList.remove('tutorial-highlight'), 4000);
      }
    }
  }

  // Expose for inline call
  window.showNextTutorial = function(index, steps) {
    const state = State.get();
    const tutEl = document.getElementById('tutorial-popup');
    if (index >= steps.length) {
      tutEl.classList.remove('show');
      state.ui.tutorialDone = true;
      return;
    }
    showTutorialStep(index, steps, state);
  };

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

import Phaser from 'phaser';

/**
 * Dive Center Tycoon
 * Portrait, iOS-only, tuned for iPhone 16 Pro Max testing (no Mac/Xcode chain yet,
 * so this stays a browser/PWA build reachable over LAN for on-device testing).
 *
 * This is a fresh scaffold after the Viking-2048 prototype: no game logic has been
 * ported over, only the display/device conditions that still apply (design
 * resolution, safe-area offset, Scale.FIT so it works on other screens too).
 */

// --- Design constants --------------------------------------------------------
const GAME_WIDTH = 440;
const GAME_HEIGHT = 956;

const SAFE_TOP = 140; // Reserved space at the top for the Dynamic Island + header

const COLOR_BG = 0x0b2733;      // Deep water background
const COLOR_PANEL = 0x123847;   // Panel/card background
const COLOR_ACCENT = 0x2fb6c9;  // Active tab / highlight
const COLOR_TEXT = '#e8f4f6';
const COLOR_TEXT_DIM = '#7fa6ae';

// --- Game clock ---------------------------------------------------------------
// A day runs 08:00 -> 23:00 at normal pace, then 23:00 -> 08:00 fast-forwards at
// 8x. Pacing constants below are placeholders for balancing later.
const DAY_START_MIN = 8 * 60;
const NIGHT_CUTOFF_MIN = 23 * 60;
const MINUTES_PER_DAY = 24 * 60;
const GAME_MINUTES_PER_REAL_SECOND = 2; // day-phase pace, tune later
const NIGHT_SPEED_MULTIPLIER = 8;

const TABS = [
  { key: 'frontdesk', label: 'Front Desk' },
  { key: 'diveops', label: 'Dive Ops' },
  { key: 'equipment', label: 'Equipment' },
];

function formatClock(totalMinutes) {
  const m = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = Math.floor(m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function isNightPhase(totalMinutes) {
  const m = totalMinutes % MINUTES_PER_DAY;
  return m >= NIGHT_CUTOFF_MIN || m < DAY_START_MIN;
}

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
    this.day = 1;
    this.clockMinutes = DAY_START_MIN;
    this.money = 0;
    this.activeTab = TABS[0].key;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR_BG);

    this.headerText = this.add.text(GAME_WIDTH / 2, SAFE_TOP - 70, '', {
      fontFamily: 'sans-serif',
      fontSize: '20px',
      color: COLOR_TEXT,
      align: 'center',
    }).setOrigin(0.5);

    this.subHeaderText = this.add.text(GAME_WIDTH / 2, SAFE_TOP - 42, '', {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      color: COLOR_TEXT_DIM,
      align: 'center',
    }).setOrigin(0.5);

    this.buildTabBar();
    this.panelContent = this.add.text(GAME_WIDTH / 2, SAFE_TOP + 120, '', {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      color: COLOR_TEXT_DIM,
      align: 'center',
      wordWrap: { width: GAME_WIDTH - 80 },
    }).setOrigin(0.5, 0);

    this.setActiveTab(this.activeTab);
    this.refreshHeader();
  }

  buildTabBar() {
    const barY = SAFE_TOP;
    const tabWidth = (GAME_WIDTH - 32) / TABS.length;

    this.tabButtons = TABS.map((tab, i) => {
      const x = 16 + tabWidth * i + tabWidth / 2;
      const bg = this.add.rectangle(x, barY, tabWidth - 8, 40, COLOR_PANEL)
        .setStrokeStyle(1, 0x1c4a5a)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(x, barY, tab.label, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5);

      bg.on('pointerdown', () => this.setActiveTab(tab.key));

      return { key: tab.key, bg, label };
    });
  }

  setActiveTab(key) {
    this.activeTab = key;
    for (const btn of this.tabButtons) {
      const active = btn.key === key;
      btn.bg.setFillStyle(active ? COLOR_ACCENT : COLOR_PANEL);
      btn.label.setColor(active ? '#08222b' : COLOR_TEXT_DIM);
    }

    const placeholders = {
      frontdesk: 'Walk-in queue and pre-bookings will show up here.\nCheck customers in to start a dive group.',
      diveops: 'Drag customers + a guide together here to form a dive group (1-6 customers, 1-3 dives) and dispatch them.',
      equipment: 'Per-customer gear sets: rinse after a dive for a bonus, maintain, replace, or upgrade for higher-value dives.',
    };
    this.panelContent.setText(placeholders[key] || '');
  }

  refreshHeader() {
    const night = isNightPhase(this.clockMinutes);
    this.headerText.setText(`Day ${this.day}  •  $${this.money}`);
    this.subHeaderText.setText(`${formatClock(this.clockMinutes)}  ${night ? '🌙 Night (fast-forward)' : '☀️ Open'}`);
  }

  update(_time, deltaMs) {
    const wasNight = isNightPhase(this.clockMinutes);
    const speed = wasNight ? NIGHT_SPEED_MULTIPLIER : 1;
    this.clockMinutes += (GAME_MINUTES_PER_REAL_SECOND * speed * deltaMs) / 1000;

    if (this.clockMinutes >= MINUTES_PER_DAY) {
      this.clockMinutes -= MINUTES_PER_DAY;
      this.day += 1;
    }

    this.refreshHeader();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0b2733',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
});

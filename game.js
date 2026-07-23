import Phaser from 'phaser';

/**
 * Dive Center Tycoon
 * Portrait, iOS-only, tuned for iPhone 16 Pro Max testing (no Mac/Xcode chain yet,
 * so this stays a browser/PWA build reachable over LAN for on-device testing).
 */

// --- Design constants --------------------------------------------------------
const GAME_WIDTH = 440;
const GAME_HEIGHT = 956;

const SAFE_TOP = 140; // Reserved space at the top for the Dynamic Island + header

const COLOR_BG = 0x0b2733;      // Deep water background
const COLOR_PANEL = 0x123847;   // Panel/card background
const COLOR_CARD = 0x184a5c;    // Queue card background
const COLOR_ACCENT = 0x2fb6c9;  // Active tab / highlight
const COLOR_TEXT = '#e8f4f6';
const COLOR_TEXT_DIM = '#7fa6ae';

// --- Game clock ---------------------------------------------------------------
// A business day runs 08:00 -> 23:00 at normal pace, then 23:00 -> 08:00 fast-
// forwards at 8x. The day counter ticks over at the 08:00 open, not at midnight.
const DAY_START_MIN = 8 * 60;
const NIGHT_CUTOFF_MIN = 23 * 60;
const MINUTES_PER_DAY = 24 * 60;
const GAME_MINUTES_PER_REAL_SECOND = 2; // day-phase pace, tune later
const NIGHT_SPEED_MULTIPLIER = 8;

// --- Front desk queue ----------------------------------------------------------
const CUSTOMER_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie',
  'Drew', 'Robin', 'Charlie', 'Skyler', 'Quinn', 'Reese', 'Avery', 'Rowan',
  'Emerson', 'Dakota', 'Finley', 'Harper',
];
const WALKIN_MIN_GAP = 20; // game-minutes between walk-in spawns
const WALKIN_MAX_GAP = 50;
const BOOKINGS_MIN_PER_DAY = 3;
const BOOKINGS_MAX_PER_DAY = 5;
const MAX_QUEUE_CARDS_SHOWN = 6;

// --- Dive ops: group assembly & dispatch ---------------------------------------
const MIN_GROUP_SIZE = 1;
const MAX_GROUP_SIZE = 6;
const MIN_GROUP_DIVES = 1;
const MAX_GROUP_DIVES = 3;
const DIVE_DURATION_MINUTES_PER_DIVE = 45; // game-minutes a group is away per dive
const DIVE_PRICE_PER_DIVE = 25;            // revenue per customer per dive
const MAX_POOL_CARDS_SHOWN = 5;
const MAX_OUT_GROUPS_SHOWN = 4;
const DIVE_OPS_REFRESH_MS = 1000; // how often the "back in Xm" timers repaint

const TABS = [
  { key: 'frontdesk', label: 'Front Desk' },
  { key: 'diveops', label: 'Dive Ops' },
  { key: 'equipment', label: 'Equipment' },
];

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomName() {
  return CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
}

function formatClock(totalMinutes) {
  const m = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = Math.floor(m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function minuteOfDay(totalMinutes) {
  return ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function isNightPhase(totalMinutes) {
  const m = minuteOfDay(totalMinutes);
  return m >= NIGHT_CUTOFF_MIN || m < DAY_START_MIN;
}

// Business-day index ticks over at each 08:00 open, not at midnight.
function dayIndex(totalMinutes) {
  return Math.floor((totalMinutes - DAY_START_MIN) / MINUTES_PER_DAY);
}

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
    this.totalMinutes = DAY_START_MIN; // Day 1, 08:00
    this.money = 0;
    this.activeTab = TABS[0].key;

    this.nextCustomerId = 1;
    this.queue = [];          // Arrived customers waiting to be checked in
    this.checkedIn = [];      // Checked in, ready for Dive Ops to pick up
    this.upcomingBookings = []; // Scheduled, not yet arrived

    this.walkInTimer = randomBetween(WALKIN_MIN_GAP, WALKIN_MAX_GAP);
    this.frontDeskDirty = true;
    this.frontDeskListObjects = [];
    this.lastDayIndex = dayIndex(this.totalMinutes);

    this.nextGroupId = 1;
    this.groupBuilder = { customers: [], diveCount: 1 };
    this.dispatchedGroups = []; // { id, customers, diveCount, returnAtMinute }
    this.stagingZoneBounds = null;
    this.diveOpsDirty = true;
    this.diveOpsListObjects = [];
    this.diveOpsRefreshAccumMs = 0;
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

    // Generate today's bookings up front since the game opens mid-day-1 at 08:00.
    this.generateBookingsForToday();

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

    // Tear down whichever tab's dynamic content was showing, then build the new one.
    this.clearFrontDeskList();
    this.clearDiveOpsList();
    this.panelContent.setText('');

    if (key === 'frontdesk') {
      this.frontDeskDirty = true;
    } else if (key === 'diveops') {
      this.diveOpsDirty = true;
    } else {
      this.panelContent.setText('Per-customer gear sets: rinse after a dive for a bonus, maintain, replace, or upgrade for higher-value dives.');
    }
  }

  refreshHeader() {
    const night = isNightPhase(this.totalMinutes);
    const day = dayIndex(this.totalMinutes) + 1;
    this.headerText.setText(`Day ${day}  •  $${this.money}`);
    this.subHeaderText.setText(`${formatClock(this.totalMinutes)}  ${night ? '🌙 Night (fast-forward)' : '☀️ Open'}`);
  }

  // --- Front desk: bookings & walk-ins ----------------------------------------

  generateBookingsForToday() {
    const todayOpenAbsolute = dayIndex(this.totalMinutes) * MINUTES_PER_DAY + DAY_START_MIN;
    const openWindow = NIGHT_CUTOFF_MIN - DAY_START_MIN;
    const count = Math.floor(randomBetween(BOOKINGS_MIN_PER_DAY, BOOKINGS_MAX_PER_DAY + 1));

    this.upcomingBookings = [];
    for (let i = 0; i < count; i++) {
      const scheduledMinute = todayOpenAbsolute + randomBetween(0, openWindow);
      // Skip slots already in the past (relevant for day 1, which opens mid-window).
      if (scheduledMinute < this.totalMinutes) continue;
      this.upcomingBookings.push({
        id: this.nextCustomerId++,
        name: randomName(),
        diveCount: 1 + Math.floor(Math.random() * 3),
        source: 'booking',
        scheduledMinute,
      });
    }
    this.upcomingBookings.sort((a, b) => a.scheduledMinute - b.scheduledMinute);
  }

  spawnWalkIn() {
    this.queue.push({
      id: this.nextCustomerId++,
      name: randomName(),
      diveCount: 1 + Math.floor(Math.random() * 3),
      source: 'walkin',
    });
    this.frontDeskDirty = true;
  }

  updateWalkInSpawner(deltaGameMinutes) {
    this.walkInTimer -= deltaGameMinutes;
    if (this.walkInTimer <= 0) {
      this.spawnWalkIn();
      this.walkInTimer = randomBetween(WALKIN_MIN_GAP, WALKIN_MAX_GAP);
    }
  }

  updateBookingArrivals() {
    const arrived = this.upcomingBookings.filter((b) => b.scheduledMinute <= this.totalMinutes);
    if (arrived.length === 0) return;

    this.upcomingBookings = this.upcomingBookings.filter((b) => b.scheduledMinute > this.totalMinutes);
    for (const booking of arrived) {
      this.queue.push(booking);
    }
    this.frontDeskDirty = true;
  }

  checkInCustomer(customerId) {
    const idx = this.queue.findIndex((c) => c.id === customerId);
    if (idx === -1) return;
    const [customer] = this.queue.splice(idx, 1);
    this.checkedIn.push(customer);
    this.frontDeskDirty = true;
  }

  clearFrontDeskList() {
    for (const obj of this.frontDeskListObjects) obj.destroy();
    this.frontDeskListObjects = [];
  }

  renderFrontDesk() {
    this.clearFrontDeskList();

    let y = SAFE_TOP + 50;

    const bookingsText = this.add.text(GAME_WIDTH / 2, y, `${this.upcomingBookings.length} booking(s) later today`, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(0.5);
    this.frontDeskListObjects.push(bookingsText);
    y += 30;

    const queueLabel = this.add.text(24, y, `Queue (${this.queue.length})`, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    });
    this.frontDeskListObjects.push(queueLabel);
    y += 28;

    if (this.queue.length === 0) {
      const empty = this.add.text(GAME_WIDTH / 2, y + 10, 'No one waiting right now.', {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5, 0);
      this.frontDeskListObjects.push(empty);
      y += 50;
    }

    const shown = this.queue.slice(0, MAX_QUEUE_CARDS_SHOWN);
    const cardHeight = 56;
    const cardGap = 8;

    for (const customer of shown) {
      const cardY = y + cardHeight / 2;
      const card = this.add.rectangle(GAME_WIDTH / 2, cardY, GAME_WIDTH - 32, cardHeight, COLOR_CARD)
        .setStrokeStyle(1, 0x1c4a5a)
        .setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this.checkInCustomer(customer.id));

      const nameText = this.add.text(32, cardY, customer.name, {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: COLOR_TEXT,
      }).setOrigin(0, 0.5);

      const tag = customer.source === 'booking' ? 'Booking' : 'Walk-in';
      const detailText = this.add.text(GAME_WIDTH - 32, cardY, `${tag}  •  ${customer.diveCount} dive${customer.diveCount > 1 ? 's' : ''}`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(1, 0.5);

      this.frontDeskListObjects.push(card, nameText, detailText);
      y += cardHeight + cardGap;
    }

    if (this.queue.length > shown.length) {
      const overflow = this.add.text(GAME_WIDTH / 2, y, `+${this.queue.length - shown.length} more waiting`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5, 0);
      this.frontDeskListObjects.push(overflow);
      y += 26;
    }

    y += 20;
    const checkedInLabel = this.add.text(24, y, `Checked in, ready to dispatch (${this.checkedIn.length})`, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    });
    this.frontDeskListObjects.push(checkedInLabel);
    y += 26;

    const checkedInNames = this.checkedIn.length > 0
      ? this.checkedIn.map((c) => `${c.name} (${c.diveCount})`).join(',  ')
      : 'Tap a queue entry above to check them in.';
    const checkedInText = this.add.text(24, y, checkedInNames, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: COLOR_TEXT_DIM,
      wordWrap: { width: GAME_WIDTH - 48 },
    });
    this.frontDeskListObjects.push(checkedInText);
  }

  // --- Dive ops: group assembly & dispatch ------------------------------------

  clearDiveOpsList() {
    for (const obj of this.diveOpsListObjects) obj.destroy();
    this.diveOpsListObjects = [];
  }

  handlePoolCardDrop(customer, pointer) {
    const inZone = this.stagingZoneBounds
      && Phaser.Geom.Rectangle.Contains(this.stagingZoneBounds, pointer.x, pointer.y);

    if (inZone && this.groupBuilder.customers.length < MAX_GROUP_SIZE) {
      const idx = this.checkedIn.findIndex((c) => c.id === customer.id);
      if (idx !== -1) {
        this.checkedIn.splice(idx, 1);
        this.groupBuilder.customers.push(customer);
      }
    }
    this.diveOpsDirty = true;
  }

  removeFromGroupBuilder(customerId) {
    const idx = this.groupBuilder.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) return;
    const [customer] = this.groupBuilder.customers.splice(idx, 1);
    this.checkedIn.push(customer);
    this.diveOpsDirty = true;
  }

  adjustGroupDiveCount(delta) {
    this.groupBuilder.diveCount = Phaser.Math.Clamp(
      this.groupBuilder.diveCount + delta,
      MIN_GROUP_DIVES,
      MAX_GROUP_DIVES,
    );
    this.diveOpsDirty = true;
  }

  dispatchGroup() {
    const { customers, diveCount } = this.groupBuilder;
    if (customers.length < MIN_GROUP_SIZE || customers.length > MAX_GROUP_SIZE) return;

    this.dispatchedGroups.push({
      id: this.nextGroupId++,
      customers,
      diveCount,
      returnAtMinute: this.totalMinutes + diveCount * DIVE_DURATION_MINUTES_PER_DIVE,
    });
    this.groupBuilder = { customers: [], diveCount: 1 };
    this.diveOpsDirty = true;
  }

  updateDiveReturns() {
    const returned = this.dispatchedGroups.filter((g) => g.returnAtMinute <= this.totalMinutes);
    if (returned.length === 0) return;

    this.dispatchedGroups = this.dispatchedGroups.filter((g) => g.returnAtMinute > this.totalMinutes);
    for (const group of returned) {
      this.money += group.diveCount * group.customers.length * DIVE_PRICE_PER_DIVE;
    }
    this.diveOpsDirty = true;
  }

  makePoolCard(customer, x, y) {
    const cardWidth = GAME_WIDTH - 32;
    const cardHeight = 48;

    const rect = this.add.rectangle(0, 0, cardWidth, cardHeight, COLOR_CARD).setStrokeStyle(1, 0x1c4a5a);
    const nameText = this.add.text(-(cardWidth / 2 - 16), 0, customer.name, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    }).setOrigin(0, 0.5);
    const detailText = this.add.text(cardWidth / 2 - 16, 0, `wants ${customer.diveCount}`, {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(1, 0.5);

    const container = this.add.container(x, y, [rect, nameText, detailText]);
    container.setSize(cardWidth, cardHeight);
    container.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(container);
    container.on('drag', (_pointer, dragX, dragY) => {
      container.x = dragX;
      container.y = dragY;
    });
    container.on('dragend', (pointer) => this.handlePoolCardDrop(customer, pointer));

    return container;
  }

  renderDiveOps() {
    this.clearDiveOpsList();
    let y = SAFE_TOP + 40;

    // --- Available pool --------------------------------------------------------
    const poolLabel = this.add.text(24, y, `Checked in, available (${this.checkedIn.length})`, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    });
    this.diveOpsListObjects.push(poolLabel);
    y += 26;

    if (this.checkedIn.length === 0) {
      const empty = this.add.text(GAME_WIDTH / 2, y, 'No one checked in yet — check customers in at the Front Desk.', {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT_DIM,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      }).setOrigin(0.5, 0);
      this.diveOpsListObjects.push(empty);
      y += 44;
    }

    const poolCardHeight = 48;
    const poolCardGap = 8;
    const poolShown = this.checkedIn.slice(0, MAX_POOL_CARDS_SHOWN);
    for (const customer of poolShown) {
      const card = this.makePoolCard(customer, GAME_WIDTH / 2, y + poolCardHeight / 2);
      this.diveOpsListObjects.push(card);
      y += poolCardHeight + poolCardGap;
    }
    if (this.checkedIn.length > poolShown.length) {
      const overflow = this.add.text(GAME_WIDTH / 2, y, `+${this.checkedIn.length - poolShown.length} more available`, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5, 0);
      this.diveOpsListObjects.push(overflow);
      y += 24;
    }

    y += 20;

    // --- New group staging area --------------------------------------------------
    const stagingLabel = this.add.text(24, y, 'New Group — drag customers here', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    });
    this.diveOpsListObjects.push(stagingLabel);
    y += 26;

    const stagingTop = y - 6;

    const guideChip = this.add.text(24, y, '🧭 Guide assigned automatically', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: COLOR_TEXT_DIM,
    });
    this.diveOpsListObjects.push(guideChip);
    y += 26;

    if (this.groupBuilder.customers.length === 0) {
      const hint = this.add.text(GAME_WIDTH / 2, y, 'Drag a checked-in customer up here (1-6 per group).', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: COLOR_TEXT_DIM,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      }).setOrigin(0.5, 0);
      this.diveOpsListObjects.push(hint);
      y += 40;
    } else {
      const chipHeight = 36;
      for (const customer of this.groupBuilder.customers) {
        const chipY = y + chipHeight / 2;
        const chip = this.add.rectangle(GAME_WIDTH / 2, chipY, GAME_WIDTH - 32, chipHeight, COLOR_PANEL)
          .setStrokeStyle(1, 0x1c4a5a)
          .setInteractive({ useHandCursor: true });
        chip.on('pointerdown', () => this.removeFromGroupBuilder(customer.id));

        const chipName = this.add.text(32, chipY, `${customer.name}  (wants ${customer.diveCount})`, {
          fontFamily: 'sans-serif',
          fontSize: '13px',
          color: COLOR_TEXT,
        }).setOrigin(0, 0.5);
        const chipRemove = this.add.text(GAME_WIDTH - 32, chipY, 'tap to remove', {
          fontFamily: 'sans-serif',
          fontSize: '11px',
          color: COLOR_TEXT_DIM,
        }).setOrigin(1, 0.5);

        this.diveOpsListObjects.push(chip, chipName, chipRemove);
        y += chipHeight + 6;
      }
    }

    // Stepper: how many dives this group's trip covers.
    const stepperY = y + 16;
    const minusBtn = this.add.rectangle(GAME_WIDTH / 2 - 60, stepperY, 36, 32, COLOR_PANEL)
      .setStrokeStyle(1, 0x1c4a5a).setInteractive({ useHandCursor: true });
    minusBtn.on('pointerdown', () => this.adjustGroupDiveCount(-1));
    const minusLabel = this.add.text(GAME_WIDTH / 2 - 60, stepperY, '-', {
      fontFamily: 'sans-serif', fontSize: '18px', color: COLOR_TEXT,
    }).setOrigin(0.5);

    const diveCountLabel = this.add.text(GAME_WIDTH / 2, stepperY, `${this.groupBuilder.diveCount} dive${this.groupBuilder.diveCount > 1 ? 's' : ''}`, {
      fontFamily: 'sans-serif', fontSize: '14px', color: COLOR_TEXT,
    }).setOrigin(0.5);

    const plusBtn = this.add.rectangle(GAME_WIDTH / 2 + 60, stepperY, 36, 32, COLOR_PANEL)
      .setStrokeStyle(1, 0x1c4a5a).setInteractive({ useHandCursor: true });
    plusBtn.on('pointerdown', () => this.adjustGroupDiveCount(1));
    const plusLabel = this.add.text(GAME_WIDTH / 2 + 60, stepperY, '+', {
      fontFamily: 'sans-serif', fontSize: '18px', color: COLOR_TEXT,
    }).setOrigin(0.5);

    this.diveOpsListObjects.push(minusBtn, minusLabel, diveCountLabel, plusBtn, plusLabel);
    y = stepperY + 30;

    // Dispatch button.
    const canDispatch = this.groupBuilder.customers.length >= MIN_GROUP_SIZE;
    const dispatchY = y + 24;
    const dispatchBtn = this.add.rectangle(GAME_WIDTH / 2, dispatchY, GAME_WIDTH - 32, 44, canDispatch ? COLOR_ACCENT : COLOR_PANEL)
      .setStrokeStyle(1, 0x1c4a5a);
    if (canDispatch) {
      dispatchBtn.setInteractive({ useHandCursor: true });
      dispatchBtn.on('pointerdown', () => this.dispatchGroup());
    }
    const dispatchLabel = this.add.text(GAME_WIDTH / 2, dispatchY, 'Dispatch group', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: canDispatch ? '#08222b' : COLOR_TEXT_DIM,
    }).setOrigin(0.5);
    this.diveOpsListObjects.push(dispatchBtn, dispatchLabel);
    y = dispatchY + 40;

    // The staging drop zone covers everything from the label down to the dispatch button.
    this.stagingZoneBounds = new Phaser.Geom.Rectangle(16, stagingTop, GAME_WIDTH - 32, y - stagingTop);

    y += 16;

    // --- Groups currently out ----------------------------------------------------
    const outLabel = this.add.text(24, y, `Out on dives (${this.dispatchedGroups.length})`, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    });
    this.diveOpsListObjects.push(outLabel);
    y += 26;

    if (this.dispatchedGroups.length === 0) {
      const empty = this.add.text(GAME_WIDTH / 2, y, 'No groups out right now.', {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5, 0);
      this.diveOpsListObjects.push(empty);
    } else {
      const outShown = this.dispatchedGroups.slice(0, MAX_OUT_GROUPS_SHOWN);
      for (const group of outShown) {
        const remaining = Math.max(0, Math.ceil(group.returnAtMinute - this.totalMinutes));
        const row = this.add.text(24, y,
          `Group of ${group.customers.length} • ${group.diveCount} dive${group.diveCount > 1 ? 's' : ''} • back in ${remaining}m`, {
            fontFamily: 'sans-serif',
            fontSize: '13px',
            color: COLOR_TEXT_DIM,
          });
        this.diveOpsListObjects.push(row);
        y += 22;
      }
      if (this.dispatchedGroups.length > outShown.length) {
        const overflow = this.add.text(24, y, `+${this.dispatchedGroups.length - outShown.length} more out`, {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          color: COLOR_TEXT_DIM,
        });
        this.diveOpsListObjects.push(overflow);
      }
    }
  }

  update(_time, deltaMs) {
    const before = this.totalMinutes;
    const night = isNightPhase(this.totalMinutes);
    const speed = night ? NIGHT_SPEED_MULTIPLIER : 1;
    const deltaGameMinutes = (GAME_MINUTES_PER_REAL_SECOND * speed * deltaMs) / 1000;
    this.totalMinutes += deltaGameMinutes;

    if (dayIndex(this.totalMinutes) !== dayIndex(before)) {
      this.generateBookingsForToday();
      this.walkInTimer = randomBetween(WALKIN_MIN_GAP, WALKIN_MAX_GAP);
    }

    if (!isNightPhase(this.totalMinutes)) {
      this.updateWalkInSpawner(deltaGameMinutes);
    }
    this.updateBookingArrivals();
    this.updateDiveReturns();

    if (this.activeTab === 'diveops' && this.dispatchedGroups.length > 0) {
      this.diveOpsRefreshAccumMs += deltaMs;
      if (this.diveOpsRefreshAccumMs >= DIVE_OPS_REFRESH_MS) {
        this.diveOpsRefreshAccumMs = 0;
        this.diveOpsDirty = true;
      }
    }

    this.refreshHeader();
    if (this.activeTab === 'frontdesk' && this.frontDeskDirty) {
      this.renderFrontDesk();
      this.frontDeskDirty = false;
    }
    if (this.activeTab === 'diveops' && this.diveOpsDirty) {
      this.renderDiveOps();
      this.diveOpsDirty = false;
    }
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

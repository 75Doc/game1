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

// Flat, warm dive-shop palette (sandy cream + teal signage + coral accents).
const COLOR_BG = 0xfbf3e0;
const COLOR_TEAL = 0x1f8a82;
const COLOR_TEAL_DARK = 0x156b64;
const COLOR_CORAL = 0xf2905e;
const COLOR_CARD = 0xffffff;
const COLOR_CARD_ALT = 0xf6ead2;
const COLOR_TEXT = '#22322f';
const COLOR_TEXT_DIM = '#6f8a84';
const COLOR_TEXT_ON_ACCENT = '#ffffff';

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
// Roughly 85% bookings / 15% walk-ins overall: ~12.5 bookings/day vs. ~2 walk-ins/day.
const WALKIN_MIN_GAP = 300; // game-minutes between walk-in spawns
const WALKIN_MAX_GAP = 600;
const BOOKINGS_MIN_PER_DAY = 11;
const BOOKINGS_MAX_PER_DAY = 14;
const MAX_QUEUE_CARDS_SHOWN = 6;

// A queued (arrived, not-yet-checked-in) customer leaves if they wait too long.
const QUEUE_PATIENCE_MIN_MINUTES = 90;
const QUEUE_PATIENCE_MAX_MINUTES = 180;

// Rental gear offered at check-in. Prices are rough real-world dive-shop day rates.
const RENTAL_ITEMS = [
  { key: 'mask_fins', label: 'Mask & Fins', price: 10 },
  { key: 'wetsuit', label: 'Wetsuit', price: 15 },
  { key: 'bcd', label: 'BCD', price: 20 },
  { key: 'regulator', label: 'Regulator', price: 20 },
  { key: 'computer', label: 'Dive Computer', price: 12 },
  { key: 'weights', label: 'Weights', price: 5 },
];

// --- Equipment: shop-owned rental gear condition, rinsing, maintenance, upgrades ----
const GEAR_MAX_CONDITION = 100;
const GEAR_WEAR_PER_USE = 6;            // condition lost per dispatch that uses a gear type
const GEAR_DIRTY_WEAR_MULTIPLIER = 2;   // extra wear if the gear wasn't rinsed since its last use
const GEAR_RINSE_RESTORE = 4;           // condition regained by rinsing
const GEAR_MAINTENANCE_COST = 30;       // fully restores condition
const GEAR_UPGRADE_COST = 150;          // one-time per gear type, halves future wear
const GEAR_MIN_PAYOUT_FACTOR = 0.6;     // revenue multiplier for a dive on fully-worn rented gear

// --- Dive ops: group assembly & dispatch ---------------------------------------
const MIN_GROUP_SIZE = 1;
const MAX_GROUP_SIZE = 6;
const MIN_GROUP_DIVES = 1;
const MAX_GROUP_DIVES = 3;
const DIVE_DURATION_MINUTES_PER_DIVE = 45; // game-minutes a group is away per dive
const DIVE_PRICE_PER_DIVE = 55;            // revenue per customer per dive (tanks/guide/boat; gear rental is separate)
const MAX_POOL_CARDS_SHOWN = 5;
const MAX_OUT_GROUPS_SHOWN = 4;
const DIVE_OPS_REFRESH_MS = 1000; // how often the "back in Xm" timers repaint

// --- Dispatch animation: little people walking to the car, car driving to the dock ---
const PERSON_HEAD_COLOR = 0xf0c9a0;
const PERSON_LEG_COLOR = 0x33302c;
const CAR_PARK_X = 150;
const CAR_PARK_Y = 858;
const DISPATCH_WALK_MS = 900;
const DISPATCH_WALK_STAGGER_MS = 130;
const DISPATCH_DRIVE_MS = 700;
const RETURN_DRIVE_MS = 700;

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

    this.dispatchAnimating = false;
    this.stagingChipObjects = [];
    this.stagingChipPositions = []; // [{ x, y, source }] snapshot for the walk animation
    this.dispatchBtnRef = null;

    this.dialogObjects = [];
    this.checkInDialogState = null; // { customer, rentals: Set<string> }

    this.gear = {};
    for (const item of RENTAL_ITEMS) {
      this.gear[item.key] = { condition: GEAR_MAX_CONDITION, dirty: false, upgraded: false };
    }
    this.equipmentDirty = true;
    this.equipmentListObjects = [];
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
    this.buildWaveDivider(SAFE_TOP + 24);

    this.panelContent = this.add.text(GAME_WIDTH / 2, SAFE_TOP + 120, '', {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      color: COLOR_TEXT_DIM,
      align: 'center',
      wordWrap: { width: GAME_WIDTH - 80 },
    }).setOrigin(0.5, 0);

    this.diveOpsDecor = this.buildDiveOpsDecor();
    this.carGraphic = this.createCarGraphic();
    this.carGraphic.setPosition(CAR_PARK_X, CAR_PARK_Y);
    this.carGraphic.setVisible(false);
    this.frontDeskDecor = this.buildFrontDeskDecor();

    // Generate today's bookings up front since the game opens mid-day-1 at 08:00.
    this.generateBookingsForToday();

    this.setActiveTab(this.activeTab);
    this.refreshHeader();
  }

  // --- Shared flat-vector helpers ----------------------------------------------

  /** A rounded-rect "card" as a Container, so children can be added at local (0,0)-relative coords. */
  createCard(x, y, w, h, fillColor, strokeColor = COLOR_TEAL, radius = 14) {
    const g = this.add.graphics();
    const redraw = (fill, stroke) => {
      g.clear();
      g.fillStyle(fill, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      g.lineStyle(2, stroke, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    };
    redraw(fillColor, strokeColor);

    const container = this.add.container(x, y, [g]);
    container.setSize(w, h);
    container.redrawCard = redraw;
    return container;
  }

  /** A small flat person silhouette (head + shirt-colored body + legs), centered at local (0,0). */
  createPersonGraphic(shirtColor) {
    const g = this.add.graphics();
    g.fillStyle(PERSON_LEG_COLOR, 1);
    g.fillRect(-6, 10, 4, 11);
    g.fillRect(2, 10, 4, 11);
    g.fillStyle(shirtColor, 1);
    g.fillRoundedRect(-8, -7, 16, 18, 4);
    g.fillStyle(PERSON_HEAD_COLOR, 1);
    g.fillCircle(0, -15, 7);
    return g;
  }

  /** A small standing person, added as a child of an existing card container. */
  addPersonAvatar(container, localX, color) {
    const person = this.createPersonGraphic(color);
    person.setPosition(localX, 3).setScale(0.55);
    container.add(person);
  }

  /** Simple flat car/jeep silhouette used for the dispatch/return animation. */
  createCarGraphic() {
    const g = this.add.graphics();
    g.fillStyle(COLOR_CORAL, 1);
    g.fillRoundedRect(-30, -12, 60, 20, 6);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-15, -23, 26, 14, 4);
    g.fillStyle(0x2b2b2b, 1);
    g.fillCircle(-18, 10, 7);
    g.fillCircle(18, 10, 7);
    return g;
  }

  buildWaveDivider(y) {
    const g = this.add.graphics();
    g.fillStyle(COLOR_TEAL, 0.35);
    for (let x = 12; x <= GAME_WIDTH; x += 22) {
      g.fillCircle(x, y, 5);
    }
    return g;
  }

  /** Simple dock + boat silhouette, anchored near the bottom of the canvas. Dive Ops only. */
  buildDiveOpsDecor() {
    const g = this.add.graphics();
    const baseY = 880;

    // Water band with a few pale wave dots along the top edge.
    g.fillStyle(0xcfe9e6, 1);
    g.fillRect(0, baseY, GAME_WIDTH, GAME_HEIGHT - baseY);
    g.fillStyle(0xffffff, 0.6);
    for (let x = 10; x < GAME_WIDTH; x += 28) {
      g.fillCircle(x, baseY + 4, 5);
    }

    // Dock: two posts + a plank.
    g.fillStyle(0x8a6b4f, 1);
    g.fillRect(40, baseY - 30, 10, 40);
    g.fillRect(90, baseY - 30, 10, 40);
    g.fillRect(30, baseY - 38, 80, 10);

    // Boat: hull, bow, cabin, small flag.
    g.fillStyle(COLOR_CORAL, 1);
    g.fillRect(210, baseY - 6, 110, 24);
    g.fillTriangle(320, baseY - 6, 320, baseY + 18, 345, baseY + 6);
    g.fillStyle(0xffffff, 1);
    g.fillRect(235, baseY - 24, 45, 18);
    g.fillStyle(COLOR_TEAL, 1);
    g.fillRect(255, baseY - 40, 3, 16);
    g.fillTriangle(258, baseY - 40, 258, baseY - 32, 272, baseY - 36);

    const container = this.add.container(0, 0, [g]);
    container.setVisible(false);
    return container;
  }

  /** Simple check-in counter, anchored near the bottom of the canvas. Front Desk only. */
  buildFrontDeskDecor() {
    const baseY = 880;
    const g = this.add.graphics();
    g.fillStyle(0x8a6b4f, 1);
    g.fillRoundedRect(40, baseY - 10, GAME_WIDTH - 80, 40, 8);
    g.fillStyle(COLOR_TEAL, 1);
    g.fillRoundedRect(70, baseY - 34, 140, 24, 6);

    const label = this.add.text(140, baseY - 22, 'CHECK-IN', {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5);

    const container = this.add.container(0, 0, [g, label]);
    container.setVisible(false);
    return container;
  }

  buildTabBar() {
    const barY = SAFE_TOP;
    const tabWidth = (GAME_WIDTH - 32) / TABS.length;

    this.tabButtons = TABS.map((tab, i) => {
      const x = 16 + tabWidth * i + tabWidth / 2;
      const container = this.createCard(x, barY, tabWidth - 8, 40, COLOR_CARD, COLOR_TEAL, 10);
      container.setInteractive({ useHandCursor: true });

      const label = this.add.text(0, 0, tab.label, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT_DIM,
      }).setOrigin(0.5);
      container.add(label);

      container.on('pointerdown', () => this.setActiveTab(tab.key));

      return { key: tab.key, container, label };
    });
  }

  setActiveTab(key) {
    // Don't let a group's people walk off mid-animation because the tab changed underneath them.
    if (this.dispatchAnimating && key !== this.activeTab) return;

    this.activeTab = key;
    for (const btn of this.tabButtons) {
      const active = btn.key === key;
      btn.container.redrawCard(active ? COLOR_TEAL : COLOR_CARD, COLOR_TEAL);
      btn.label.setColor(active ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM);
    }

    // Tear down whichever tab's dynamic content was showing, then build the new one.
    this.clearFrontDeskList();
    this.clearDiveOpsList();
    this.clearEquipmentList();
    this.panelContent.setText('');
    this.diveOpsDecor.setVisible(key === 'diveops');
    this.carGraphic.setVisible(key === 'diveops');
    this.frontDeskDecor.setVisible(key === 'frontdesk');
    if (key === 'diveops') {
      // Defensive reset in case a return-trip car animation was interrupted by leaving the tab.
      this.tweens.killTweensOf(this.carGraphic);
      this.carGraphic.setPosition(CAR_PARK_X, CAR_PARK_Y).setAlpha(1);
    }

    if (key === 'frontdesk') {
      this.frontDeskDirty = true;
    } else if (key === 'diveops') {
      this.diveOpsDirty = true;
    } else {
      this.equipmentDirty = true;
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
      patienceMinutes: randomBetween(QUEUE_PATIENCE_MIN_MINUTES, QUEUE_PATIENCE_MAX_MINUTES),
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
      booking.patienceMinutes = randomBetween(QUEUE_PATIENCE_MIN_MINUTES, QUEUE_PATIENCE_MAX_MINUTES);
      this.queue.push(booking);
    }
    this.frontDeskDirty = true;
  }

  /** Queued customers (arrived, not yet checked in) leave if they wait too long. */
  updateQueuePatience(deltaGameMinutes) {
    if (this.queue.length === 0) return;
    for (const customer of this.queue) {
      customer.patienceMinutes -= deltaGameMinutes;
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((c) => c.patienceMinutes > 0);
    if (this.queue.length !== before) this.frontDeskDirty = true;
  }

  checkInCustomer(customerId) {
    const idx = this.queue.findIndex((c) => c.id === customerId);
    if (idx === -1) return;
    const [customer] = this.queue.splice(idx, 1);
    this.checkedIn.push(customer);
    this.frontDeskDirty = true;
  }

  // --- Check-in dialog: what gear the customer already has vs. needs to rent ------

  openCheckInDialog(customer) {
    if (this.checkInDialogState) return;
    this.checkInDialogState = { customer, rentals: new Set() };
    this.renderCheckInDialog();
  }

  closeCheckInDialog() {
    for (const obj of this.dialogObjects) obj.destroy();
    this.dialogObjects = [];
    this.checkInDialogState = null;
  }

  toggleRentalItem(key) {
    const { rentals } = this.checkInDialogState;
    if (rentals.has(key)) rentals.delete(key);
    else rentals.add(key);
    this.renderCheckInDialog();
  }

  confirmCheckIn() {
    const { customer, rentals } = this.checkInDialogState;
    const total = RENTAL_ITEMS
      .filter((item) => rentals.has(item.key))
      .reduce((sum, item) => sum + item.price, 0);
    customer.rentals = Array.from(rentals);
    this.money += total;
    this.equipmentDirty = true;
    this.closeCheckInDialog();
    this.checkInCustomer(customer.id);
  }

  renderCheckInDialog() {
    for (const obj of this.dialogObjects) obj.destroy();
    this.dialogObjects = [];
    const { customer, rentals } = this.checkInDialogState;

    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.5)
      .setInteractive();
    this.dialogObjects.push(overlay);

    const rowHeight = 38;
    const panelWidth = GAME_WIDTH - 48;
    const panelHeight = 96 + RENTAL_ITEMS.length * rowHeight + 74;
    const panelX = GAME_WIDTH / 2;
    const panelY = GAME_HEIGHT / 2;
    const panelTop = panelY - panelHeight / 2;

    const panel = this.createCard(panelX, panelY, panelWidth, panelHeight, COLOR_CARD, COLOR_TEAL, 16);
    this.dialogObjects.push(panel);

    let y = panelTop + 26;
    const title = this.add.text(panelX, y, `${customer.name} — check in`, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: COLOR_TEXT,
    }).setOrigin(0.5);
    this.dialogObjects.push(title);
    y += 22;

    const subtitle = this.add.text(panelX, y, `Wants ${customer.diveCount} dive${customer.diveCount > 1 ? 's' : ''} — what gear do they have?`, {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: COLOR_TEXT_DIM,
      align: 'center',
      wordWrap: { width: panelWidth - 40 },
    }).setOrigin(0.5, 0);
    this.dialogObjects.push(subtitle);
    y += 32;

    for (const item of RENTAL_ITEMS) {
      const renting = rentals.has(item.key);
      const rowY = y + rowHeight / 2;

      const label = this.add.text(panelX - panelWidth / 2 + 20, rowY, item.label, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: COLOR_TEXT,
      }).setOrigin(0, 0.5);
      this.dialogObjects.push(label);

      const toggleW = 96;
      const toggle = this.createCard(panelX + panelWidth / 2 - 20 - toggleW / 2, rowY, toggleW, 28,
        renting ? COLOR_CORAL : COLOR_CARD_ALT, COLOR_TEAL, 14);
      toggle.setInteractive({ useHandCursor: true });
      toggle.on('pointerdown', () => this.toggleRentalItem(item.key));
      const toggleLabel = this.add.text(0, 0, renting ? `Rent $${item.price}` : 'Own', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: renting ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM,
      }).setOrigin(0.5);
      toggle.add(toggleLabel);
      this.dialogObjects.push(toggle);

      y += rowHeight;
    }

    const total = RENTAL_ITEMS
      .filter((item) => rentals.has(item.key))
      .reduce((sum, item) => sum + item.price, 0);
    y += 6;
    const totalText = this.add.text(panelX, y, `Rental total: $${total}`, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: COLOR_TEXT,
    }).setOrigin(0.5, 0);
    this.dialogObjects.push(totalText);
    y += 34;

    const btnY = y + 20;
    const cancelBtn = this.createCard(panelX - panelWidth / 4, btnY, panelWidth / 2 - 32, 40, COLOR_CARD_ALT, COLOR_TEAL, 12);
    cancelBtn.setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerdown', () => this.closeCheckInDialog());
    const cancelLabel = this.add.text(0, 0, 'Cancel', {
      fontFamily: 'sans-serif', fontSize: '13px', color: COLOR_TEXT,
    }).setOrigin(0.5);
    cancelBtn.add(cancelLabel);
    this.dialogObjects.push(cancelBtn);

    const confirmBtn = this.createCard(panelX + panelWidth / 4, btnY, panelWidth / 2 - 32, 40, COLOR_TEAL, COLOR_TEAL, 12);
    confirmBtn.setInteractive({ useHandCursor: true });
    confirmBtn.on('pointerdown', () => this.confirmCheckIn());
    const confirmLabel = this.add.text(0, 0, 'Confirm', {
      fontFamily: 'sans-serif', fontSize: '13px', color: COLOR_TEXT_ON_ACCENT,
    }).setOrigin(0.5);
    confirmBtn.add(confirmLabel);
    this.dialogObjects.push(confirmBtn);
  }

  clearFrontDeskList() {
    for (const obj of this.frontDeskListObjects) obj.destroy();
    this.frontDeskListObjects = [];
  }

  buildQueueCard(customer, topY) {
    const w = GAME_WIDTH - 32;
    const h = 56;
    const container = this.createCard(GAME_WIDTH / 2, topY + h / 2, w, h, COLOR_CARD, COLOR_TEAL, 14);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => this.openCheckInDialog(customer));

    const avatarColor = customer.source === 'booking' ? COLOR_TEAL : COLOR_CORAL;
    this.addPersonAvatar(container, -(w / 2) + 30, avatarColor);

    const nameText = this.add.text(-(w / 2) + 56, 0, customer.name, {
      fontFamily: 'sans-serif',
      fontSize: '15px',
      color: COLOR_TEXT,
    }).setOrigin(0, 0.5);

    const tag = customer.source === 'booking' ? 'Booking' : 'Walk-in';
    const detailText = this.add.text(w / 2 - 16, 0, `${tag}  •  ${customer.diveCount} dive${customer.diveCount > 1 ? 's' : ''}`, {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(1, 0.5);

    container.add([nameText, detailText]);
    return container;
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
      this.frontDeskListObjects.push(this.buildQueueCard(customer, y));
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

  // --- Equipment: shop-owned rental gear condition -----------------------------

  /** Revenue multiplier a single gear type currently commands, based on wear. */
  gearConditionFactor(key) {
    const ratio = this.gear[key].condition / GEAR_MAX_CONDITION;
    return GEAR_MIN_PAYOUT_FACTOR + (1 - GEAR_MIN_PAYOUT_FACTOR) * ratio;
  }

  /** A customer's dive pays full price unless gear they rented (not owned) is worn down. */
  customerPayoutFactor(customer) {
    const keys = customer.rentals || [];
    if (keys.length === 0) return 1;
    const total = keys.reduce((sum, key) => sum + this.gearConditionFactor(key), 0);
    return total / keys.length;
  }

  /** Wears every gear type rented by anyone in a dispatched group, once per type. */
  applyGearWear(customers) {
    const usedKeys = new Set();
    for (const c of customers) {
      for (const key of (c.rentals || [])) usedKeys.add(key);
    }
    for (const key of usedKeys) {
      const gear = this.gear[key];
      const wear = GEAR_WEAR_PER_USE * (gear.dirty ? GEAR_DIRTY_WEAR_MULTIPLIER : 1) * (gear.upgraded ? 0.5 : 1);
      gear.condition = Math.max(0, gear.condition - wear);
      gear.dirty = true;
    }
    this.equipmentDirty = true;
  }

  rinseGear(key) {
    const gear = this.gear[key];
    if (!gear.dirty) return;
    gear.dirty = false;
    gear.condition = Math.min(GEAR_MAX_CONDITION, gear.condition + GEAR_RINSE_RESTORE);
    this.equipmentDirty = true;
  }

  maintainGear(key) {
    const gear = this.gear[key];
    if (gear.condition >= GEAR_MAX_CONDITION || this.money < GEAR_MAINTENANCE_COST) return;
    this.money -= GEAR_MAINTENANCE_COST;
    gear.condition = GEAR_MAX_CONDITION;
    this.equipmentDirty = true;
  }

  upgradeGear(key) {
    const gear = this.gear[key];
    if (gear.upgraded || this.money < GEAR_UPGRADE_COST) return;
    this.money -= GEAR_UPGRADE_COST;
    gear.upgraded = true;
    this.equipmentDirty = true;
  }

  conditionColor(condition) {
    if (condition >= 70) return COLOR_TEAL;
    if (condition >= 40) return COLOR_CORAL;
    return 0xb0402c;
  }

  clearEquipmentList() {
    for (const obj of this.equipmentListObjects) obj.destroy();
    this.equipmentListObjects = [];
  }

  /** Returns the row's display objects (a background card plus flat, absolutely-positioned
   *  interactive buttons — matching the sibling-list pattern the check-in dialog and Dive Ops
   *  stepper use, rather than nesting interactive cards inside another container). */
  buildGearRow(item, topY) {
    const w = GAME_WIDTH - 32;
    const h = 112;
    const gear = this.gear[item.key];
    const cx = GAME_WIDTH / 2;
    const cy = topY + h / 2;
    const objects = [];

    const container = this.createCard(cx, cy, w, h, COLOR_CARD, COLOR_TEAL, 14);
    objects.push(container);

    const label = this.add.text(-(w / 2) + 16, -h / 2 + 16, item.label, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: COLOR_TEXT,
    }).setOrigin(0, 0.5);

    const statusBits = [];
    if (gear.upgraded) statusBits.push('Upgraded');
    statusBits.push(gear.dirty ? 'Needs rinse' : 'Clean');
    const status = this.add.text(w / 2 - 16, -h / 2 + 16, statusBits.join('  •  '), {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: gear.dirty ? COLOR_CORAL : COLOR_TEXT_DIM,
    }).setOrigin(1, 0.5);

    const barY = -h / 2 + 44;
    const barW = w - 32;
    const barBg = this.add.rectangle(0, barY, barW, 10, 0xe7ddc4).setOrigin(0.5);
    const fillW = Math.max(2, barW * (gear.condition / GEAR_MAX_CONDITION));
    const barFill = this.add.rectangle(-barW / 2, barY, fillW, 10, this.conditionColor(gear.condition)).setOrigin(0, 0.5);
    const conditionText = this.add.text(0, barY + 18, `${Math.round(gear.condition)}% condition`, {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(0.5);

    container.add([label, status, barBg, barFill, conditionText]);

    const btnY = cy + (h / 2 - 24);
    const btnW = (w - 32 - 16) / 3;
    const btnX = (i) => cx - w / 2 + 16 + btnW / 2 + i * (btnW + 8);

    const rinseBtn = this.createCard(btnX(0), btnY, btnW, 32,
      gear.dirty ? COLOR_TEAL : COLOR_CARD_ALT, COLOR_TEAL, 8);
    if (gear.dirty) {
      rinseBtn.setInteractive({ useHandCursor: true });
      rinseBtn.on('pointerdown', () => this.rinseGear(item.key));
    }
    const rinseLabel = this.add.text(0, 0, 'Rinse', {
      fontFamily: 'sans-serif', fontSize: '11px', color: gear.dirty ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM,
    }).setOrigin(0.5);
    rinseBtn.add(rinseLabel);
    objects.push(rinseBtn);

    const canMaintain = gear.condition < GEAR_MAX_CONDITION && this.money >= GEAR_MAINTENANCE_COST;
    const maintainBtn = this.createCard(btnX(1), btnY, btnW, 32,
      canMaintain ? COLOR_TEAL : COLOR_CARD_ALT, COLOR_TEAL, 8);
    if (canMaintain) {
      maintainBtn.setInteractive({ useHandCursor: true });
      maintainBtn.on('pointerdown', () => this.maintainGear(item.key));
    }
    const maintainLabel = this.add.text(0, 0, `Fix $${GEAR_MAINTENANCE_COST}`, {
      fontFamily: 'sans-serif', fontSize: '11px', color: canMaintain ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM,
    }).setOrigin(0.5);
    maintainBtn.add(maintainLabel);
    objects.push(maintainBtn);

    const canUpgrade = !gear.upgraded && this.money >= GEAR_UPGRADE_COST;
    const upgradeBtn = this.createCard(btnX(2), btnY, btnW, 32,
      canUpgrade ? COLOR_CORAL : COLOR_CARD_ALT, COLOR_TEAL, 8);
    if (canUpgrade) {
      upgradeBtn.setInteractive({ useHandCursor: true });
      upgradeBtn.on('pointerdown', () => this.upgradeGear(item.key));
    }
    const upgradeLabel = this.add.text(0, 0, gear.upgraded ? 'Upgraded' : `Upgrade $${GEAR_UPGRADE_COST}`, {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: gear.upgraded ? COLOR_TEXT_DIM : (canUpgrade ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM),
    }).setOrigin(0.5);
    upgradeBtn.add(upgradeLabel);
    objects.push(upgradeBtn);

    return objects;
  }

  renderEquipment() {
    this.clearEquipmentList();
    let y = SAFE_TOP + 40;

    const intro = this.add.text(GAME_WIDTH / 2, y,
      'Rented gear wears with use. Rinse it after a dive, pay to fix it up, or upgrade it to wear slower.', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: COLOR_TEXT_DIM,
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 64 },
      }).setOrigin(0.5, 0);
    this.equipmentListObjects.push(intro);
    y += 40;

    const rowHeight = 112;
    const rowGap = 8;
    for (const item of RENTAL_ITEMS) {
      this.equipmentListObjects.push(...this.buildGearRow(item, y));
      y += rowHeight + rowGap;
    }
  }

  // --- Dive ops: group assembly & dispatch ------------------------------------

  clearDiveOpsList() {
    for (const obj of this.diveOpsListObjects) obj.destroy();
    this.diveOpsListObjects = [];
    this.stagingChipObjects = [];
    this.stagingChipPositions = [];
    this.dispatchBtnRef = null;
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
    if (this.dispatchAnimating) return;
    const { customers, diveCount } = this.groupBuilder;
    if (customers.length < MIN_GROUP_SIZE || customers.length > MAX_GROUP_SIZE) return;

    this.dispatchAnimating = true;
    if (this.dispatchBtnRef) this.dispatchBtnRef.disableInteractive();
    for (const chip of this.stagingChipObjects) chip.setVisible(false);

    const positions = this.stagingChipPositions;
    positions.forEach((pos, i) => {
      const color = pos.source === 'booking' ? COLOR_TEAL : COLOR_CORAL;
      const person = this.createPersonGraphic(color);
      const startX = GAME_WIDTH / 2 + (i - (positions.length - 1) / 2) * 24;
      person.setPosition(startX, pos.y);

      const bob = this.tweens.add({ targets: person, scaleY: 0.85, duration: 140, yoyo: true, repeat: -1 });
      this.tweens.add({
        targets: person,
        x: CAR_PARK_X + Phaser.Math.Between(-12, 12),
        y: CAR_PARK_Y,
        duration: DISPATCH_WALK_MS,
        delay: i * DISPATCH_WALK_STAGGER_MS,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          bob.stop();
          person.destroy();
        },
      });
    });

    const totalWalkMs = DISPATCH_WALK_MS + (positions.length - 1) * DISPATCH_WALK_STAGGER_MS + 100;
    this.time.delayedCall(totalWalkMs, () => {
      this.tweens.add({
        targets: this.carGraphic,
        x: GAME_WIDTH + 60,
        duration: DISPATCH_DRIVE_MS,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.carGraphic.setPosition(CAR_PARK_X, CAR_PARK_Y).setAlpha(1);
          this.finalizeDispatch(customers, diveCount);
          this.dispatchAnimating = false;
        },
      });
    });
  }

  finalizeDispatch(customers, diveCount) {
    // Snapshot the payout factor before this trip's wear is applied, so the price reflects
    // the gear condition the customers actually dove with.
    const payoutFactor = customers.length > 0
      ? customers.reduce((sum, c) => sum + this.customerPayoutFactor(c), 0) / customers.length
      : 1;
    this.applyGearWear(customers);

    this.dispatchedGroups.push({
      id: this.nextGroupId++,
      customers,
      diveCount,
      payoutFactor,
      returnAtMinute: this.totalMinutes + diveCount * DIVE_DURATION_MINUTES_PER_DIVE,
    });
    this.groupBuilder = { customers: [], diveCount: 1 };
    this.diveOpsDirty = true;
  }

  playReturnAnimation() {
    if (this.dispatchAnimating || this.activeTab !== 'diveops') return;

    this.carGraphic.setPosition(GAME_WIDTH + 60, CAR_PARK_Y).setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: this.carGraphic,
      x: CAR_PARK_X,
      duration: RETURN_DRIVE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.carGraphic,
          alpha: 0,
          delay: 300,
          duration: 400,
          onComplete: () => {
            this.carGraphic.setPosition(CAR_PARK_X, CAR_PARK_Y).setAlpha(1);
          },
        });
      },
    });
  }

  updateDiveReturns() {
    const returned = this.dispatchedGroups.filter((g) => g.returnAtMinute <= this.totalMinutes);
    if (returned.length === 0) return;

    this.dispatchedGroups = this.dispatchedGroups.filter((g) => g.returnAtMinute > this.totalMinutes);
    for (const group of returned) {
      const factor = group.payoutFactor ?? 1;
      this.money += Math.round(group.diveCount * group.customers.length * DIVE_PRICE_PER_DIVE * factor);
    }
    this.diveOpsDirty = true;
    this.equipmentDirty = true;
    this.playReturnAnimation();
  }

  makePoolCard(customer, x, y) {
    const w = GAME_WIDTH - 32;
    const h = 48;
    const container = this.createCard(x, y, w, h, COLOR_CARD, COLOR_TEAL, 12);
    container.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(container);

    const avatarColor = customer.source === 'booking' ? COLOR_TEAL : COLOR_CORAL;
    this.addPersonAvatar(container, -(w / 2) + 26, avatarColor);

    const nameText = this.add.text(-(w / 2) + 50, 0, customer.name, {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: COLOR_TEXT,
    }).setOrigin(0, 0.5);
    const detailText = this.add.text(w / 2 - 16, 0, `wants ${customer.diveCount}`, {
      fontFamily: 'sans-serif',
      fontSize: '12px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(1, 0.5);
    container.add([nameText, detailText]);

    container.on('drag', (_pointer, dragX, dragY) => {
      container.x = dragX;
      container.y = dragY;
    });
    container.on('dragend', (pointer) => this.handlePoolCardDrop(customer, pointer));

    return container;
  }

  makeStagingChip(customer, topY) {
    const w = GAME_WIDTH - 32;
    const h = 36;
    const container = this.createCard(GAME_WIDTH / 2, topY + h / 2, w, h, COLOR_CARD_ALT, COLOR_TEAL, 10);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => this.removeFromGroupBuilder(customer.id));

    const avatarColor = customer.source === 'booking' ? COLOR_TEAL : COLOR_CORAL;
    this.addPersonAvatar(container, -(w / 2) + 22, avatarColor);

    const nameText = this.add.text(-(w / 2) + 44, 0, `${customer.name} (wants ${customer.diveCount})`, {
      fontFamily: 'sans-serif',
      fontSize: '13px',
      color: COLOR_TEXT,
    }).setOrigin(0, 0.5);
    const removeText = this.add.text(w / 2 - 16, 0, 'tap to remove', {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: COLOR_TEXT_DIM,
    }).setOrigin(1, 0.5);
    container.add([nameText, removeText]);

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
        const chip = this.makeStagingChip(customer, y);
        this.diveOpsListObjects.push(chip);
        this.stagingChipObjects.push(chip);
        this.stagingChipPositions.push({ x: chip.x, y: chip.y, source: customer.source });
        y += chipHeight + 6;
      }
    }

    // Stepper: how many dives this group's trip covers.
    const stepperY = y + 16;
    const minusBtn = this.createCard(GAME_WIDTH / 2 - 60, stepperY, 36, 32, COLOR_CARD, COLOR_TEAL, 8);
    minusBtn.setInteractive({ useHandCursor: true });
    minusBtn.on('pointerdown', () => this.adjustGroupDiveCount(-1));
    const minusLabel = this.add.text(0, 0, '-', {
      fontFamily: 'sans-serif', fontSize: '18px', color: COLOR_TEXT,
    }).setOrigin(0.5);
    minusBtn.add(minusLabel);

    const diveCountLabel = this.add.text(GAME_WIDTH / 2, stepperY, `${this.groupBuilder.diveCount} dive${this.groupBuilder.diveCount > 1 ? 's' : ''}`, {
      fontFamily: 'sans-serif', fontSize: '14px', color: COLOR_TEXT,
    }).setOrigin(0.5);

    const plusBtn = this.createCard(GAME_WIDTH / 2 + 60, stepperY, 36, 32, COLOR_CARD, COLOR_TEAL, 8);
    plusBtn.setInteractive({ useHandCursor: true });
    plusBtn.on('pointerdown', () => this.adjustGroupDiveCount(1));
    const plusLabel = this.add.text(0, 0, '+', {
      fontFamily: 'sans-serif', fontSize: '18px', color: COLOR_TEXT,
    }).setOrigin(0.5);
    plusBtn.add(plusLabel);

    this.diveOpsListObjects.push(minusBtn, diveCountLabel, plusBtn);
    y = stepperY + 30;

    // Dispatch button.
    const canDispatch = this.groupBuilder.customers.length >= MIN_GROUP_SIZE;
    const dispatchY = y + 24;
    const dispatchBtn = this.createCard(GAME_WIDTH / 2, dispatchY, GAME_WIDTH - 32, 44,
      canDispatch ? COLOR_TEAL : COLOR_CARD_ALT, COLOR_TEAL, 14);
    if (canDispatch) {
      dispatchBtn.setInteractive({ useHandCursor: true });
      dispatchBtn.on('pointerdown', () => this.dispatchGroup());
    }
    const dispatchLabel = this.add.text(0, 0, 'Dispatch group', {
      fontFamily: 'sans-serif',
      fontSize: '14px',
      color: canDispatch ? COLOR_TEXT_ON_ACCENT : COLOR_TEXT_DIM,
    }).setOrigin(0.5);
    dispatchBtn.add(dispatchLabel);
    this.diveOpsListObjects.push(dispatchBtn);
    this.dispatchBtnRef = dispatchBtn;
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
    this.updateQueuePatience(deltaGameMinutes);
    this.updateDiveReturns();

    if (this.activeTab === 'diveops' && this.dispatchedGroups.length > 0) {
      this.diveOpsRefreshAccumMs += deltaMs;
      if (this.diveOpsRefreshAccumMs >= DIVE_OPS_REFRESH_MS) {
        this.diveOpsRefreshAccumMs = 0;
        this.diveOpsDirty = true;
      }
    }

    this.refreshHeader();
    if (this.activeTab === 'frontdesk' && this.frontDeskDirty && !this.checkInDialogState) {
      this.renderFrontDesk();
      this.frontDeskDirty = false;
    }
    if (this.activeTab === 'diveops' && this.diveOpsDirty && !this.dispatchAnimating) {
      this.renderDiveOps();
      this.diveOpsDirty = false;
    }
    if (this.activeTab === 'equipment' && this.equipmentDirty) {
      this.renderEquipment();
      this.equipmentDirty = false;
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#fbf3e0',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
});

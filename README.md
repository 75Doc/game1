# Dive Center Tycoon

A 2D management/tycoon game: run a dive center, check in customers (walk-ins and
pre-bookings), assemble dive groups (1 guide + 1-6 customers, 1-3 dives), dispatch
them, rinse/maintain gear, and grow into a chain of dive centers across locations.

**Platform: iOS only.** Not targeting PC or Android. Built as a Phaser + Vite web
app so it can be tested in mobile Safari / added to the home screen without a
Mac in the loop; a native wrapper (Xcode/TestFlight) is a later step once that
tooling is available.

## Stack

- [Phaser 4](https://phaser.io/) for rendering/input
- [Vite](https://vitejs.dev/) for dev server + bundling
- Plain JS (ES modules), no framework

## Local development

```bash
npm install
npm run dev
```

This starts Vite on `http://localhost:5173` with `--host`, so it's also reachable
from other devices on the same Wi-Fi network (see below).

## Testing on iPhone (no Mac / Xcode required)

1. Make sure your iPhone and this computer are on the **same Wi-Fi network**.
2. Run `npm run dev`.
3. Find this computer's LAN IP (Windows: `ipconfig`, look for the Wi-Fi
   adapter's IPv4 address — e.g. `192.168.1.116`).
4. On the iPhone, open Safari and go to `http://<that-ip>:5173` (e.g.
   `http://192.168.1.116:5173`).
5. Optional: "Share" → "Add to Home Screen" to test it like an installed app
   (uses the `apple-mobile-web-app-*` meta tags in `index.html`).

If the phone can't connect, Windows Firewall may be blocking the incoming
connection the first time — allow Node.js on **private networks** when prompted
(or add an inbound rule for the Vite port).

Primary test device: **iPhone 16 Pro Max**. The game's design resolution
(440x956 in `game.js`) and safe-area offsets are tuned for it; Phaser's
`Scale.FIT` keeps it proportional on other screens.

## Working across devices

This project gets worked on from multiple places — this desktop, Claude Code on
mobile, and claude.ai — so GitHub (`75Doc/game1`) is the source of truth:

- Commit and push after a meaningful chunk of work, from whichever surface you're on.
- Pull before starting a new session on a different device, so you're not
  working from a stale copy.
- Keep `node_modules/` out of git (already in `.gitignore`) — run `npm install`
  fresh on each machine.

## Status

Early scaffold: day/night clock and a 3-tab shell (Front Desk / Dive Ops /
Equipment) are in place as placeholders. Core loop (customers, group assembly,
dispatch, gear wear/rinse/upgrade, economy) is not implemented yet.

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

## Live preview (works anywhere, no LAN/PC required)

**https://dive-center-tycoon.vercel.app**

This is a Vercel project imported from this GitHub repo (`75Doc/game1`, `main`
branch, team **Doc75**), so it **auto-deploys on every push to `main`** — no
manual redeploy step needed from any device. Use this URL to test on the
iPhone from anywhere (not tied to being on the home Wi-Fi or the PC being on);
use the LAN dev server above when you want live changes without pushing first.

## Working across devices

This project gets worked on from multiple places — this desktop, Claude Code on
mobile, and claude.ai — so GitHub (`75Doc/game1`) is the source of truth:

- Commit and push after a meaningful chunk of work, from whichever surface you're on.
- Pull before starting a new session on a different device, so you're not
  working from a stale copy.
- Keep `node_modules/` out of git (already in `.gitignore`) — run `npm install`
  fresh on each machine.

## Status

- **Front Desk**: a mix of pre-bookings (~85%) and walk-ins (~15%) arrive over
  the day. Tapping a queue entry opens a check-in dialog — mark which gear
  they own vs. need to rent (prices are rough real-world dive-shop rates);
  rentals are charged immediately. Queued customers who wait too long
  (a hidden per-customer patience timer) leave without checking in.
- **Dive Ops**: drag checked-in customers into a new group (1-6, guide is
  automatic/unlimited for now), pick a dive count (1-3), dispatch. Dispatching
  plays a little walk-to-car-and-drive-off animation; the group pays out
  ($55/customer/dive — tanks/guide/boat, gear is billed separately at
  check-in) automatically when the car drives back on return.
- **Equipment**: each rental gear type (mask & fins, wetsuit, BCD, regulator,
  computer, weights) has its own condition (0-100%). Dispatching a group
  wears every gear type its customers rented (not gear they already owned);
  worn gear that wasn't rinsed since its last trip wears twice as fast next
  time. Tap **Rinse** (free) after a trip to reset that and claw back a
  little condition, **Fix** ($30) to fully restore it, or **Upgrade** ($150,
  one-time per type) to permanently halve its wear rate. Condition isn't
  just cosmetic — a dive where the customers' rented gear is worn down pays
  out less (down to 60% of normal at 0% condition), so letting gear degrade
  quietly costs money.

# caitlincameron.ski

A small, static holding site for **caitlincameron.ski**. It politely tells
visitors that the full site is on its way — first in German, then in English —
and offers a small 3D slalom mini-game (built with three.js) while they wait.

The site is intentionally tiny: plain HTML, CSS and JavaScript, no build step,
no framework. The only dependency is a vendored copy of three.js for the game. It is designed to be deployed to
[Cloudflare Pages](https://pages.cloudflare.com/) as a static asset bundle.

## What's on the site

- **Bilingual coming-soon message** (German first, then English) at the top of
  the page. The German message is intended to be the primary message, with
  English as a courtesy translation for international visitors.
- **A small 3D slalom game** below the message, rendered with three.js:
  a chase camera behind the skier, red/blue GS gates whose poles get knocked
  when you clip them, ski tracks, snow spray, falling snow, trees and a
  mountain backdrop. The piste is tilted about 15° while the camera and
  horizon stay level, so it drops away into a hazy valley. It follows the
  light/dark colour scheme (day or dusk).
  Speed creeps up as you clear gates and drops back when you miss one.
  Simple synthesised sounds (Web Audio, no files): start beeps, a chime per
  gate that climbs with each one in a row, pole slaps, a miss buzz, and wind
  and edge hiss that follow speed and carving. A Sound on/off button (or
  <kbd>M</kbd>) mutes them, remembered on the device. iOS handling follows
  GoblinSteel: `audioSession` set to playback, unlock on tap, resume
  after interruptions, and a stall watchdog.
  three.js only loads when the game scrolls near the screen, and browsers
  without WebGL get the original 2D canvas game instead. The game is optional and
  visually subordinate to the message — visitors should be able to read the
  notice without playing.
- **An About page** at `/about/` describing what the site is and who it is for.

## Project structure

```
.
├── index.html            # Holding page with bilingual message and game
├── about/
│   └── index.html        # About page
├── assets/
│   ├── css/
│   │   └── styles.css    # All styles, including the game canvas frame
│   ├── js/
│   │   ├── main.js       # Small helpers (e.g. footer year)
│   │   ├── slalom3d.js   # Slalom mini-game (three.js / WebGL)
│   │   ├── slalom-audio.js # Synthesised sounds (Web Audio)
│   │   ├── slalom-2d.js  # Original 2D canvas game, used as a fallback
│   │   └── vendor/three/ # three.js r170 (ES module) + MIT licence
│   └── favicon.svg       # Ski-themed favicon
├── _headers              # Cloudflare Pages response headers
├── docs/
│   └── implementation-plan.md
├── .gitignore
└── README.md
```

## Local development

There is no build step. To work on the site locally, serve the directory with
any static file server, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Opening `index.html` directly with `file://` will also mostly work, but a
local server is recommended so absolute paths (`/assets/...`, `/about/`)
resolve the same way they will in production.

## Deployment

The site is deployed via Cloudflare Pages. Pushes to the `main` branch are
picked up automatically.

- **Build command:** _(none)_
- **Output directory:** `/` (the repository root)
- **Production domain:** `caitlincameron.ski` (set up in the Cloudflare Pages
  project settings under _Custom domains_).

Response headers (cache control, basic security headers) are configured in
the [`_headers`](./_headers) file, which Cloudflare Pages picks up
automatically. Our own HTML, CSS and JS use Pages' default caching
(revalidate every time, so updates show straight away). Only the vendored
three.js is cached long-term. The `?v=` on the CSS/JS links was added once
to get past copies that browsers had cached under the old one-year rule.

## Browser support

Targets evergreen browsers (current Chrome, Firefox, Safari, Edge) on desktop
and mobile. The game uses WebGL via three.js (an ES module) and standard keyboard /
pointer events. Without WebGL it falls back to the original 2D `<canvas>`
game; on very old browsers without module support the canvas simply stays
empty while the rest of the page continues to work. Add `?debug` to the URL
to expose the game state as `window.__slalom` in the console.

## Accessibility

- Both languages are marked up with `lang` attributes so screen readers
  pronounce them correctly.
- The game canvas has an `aria-label` and is **not** required to read the
  page — it sits below the main message and can be ignored entirely.
- Colours respect `prefers-color-scheme`.
- Motion in the game responds to keyboard input only on the page that
  contains it; no background animation runs on other pages.

## License

This holding site is © Caitlin Cameron. All rights reserved.

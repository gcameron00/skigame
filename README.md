# caitlincameron.ski

A small, static holding site for **caitlincameron.ski**. It politely tells
visitors that the full site is on its way — first in German, then in English —
and offers a small slalom mini-game while they wait.

The site is intentionally tiny: plain HTML, CSS and JavaScript, no build step,
no framework, no dependencies. It is designed to be deployed to
[Cloudflare Pages](https://pages.cloudflare.com/) as a static asset bundle.

## What's on the site

- **Bilingual coming-soon message** (German first, then English) at the top of
  the page. The German message is intended to be the primary message, with
  English as a courtesy translation for international visitors.
- **A tiny slalom skier game** below the message. The game is optional and
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
│   │   └── slalom.js     # Slalom mini-game (canvas-based)
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
automatically.

## Browser support

Targets evergreen browsers (current Chrome, Firefox, Safari, Edge) on desktop
and mobile. The game uses the 2D `<canvas>` API and standard keyboard /
pointer events; on very old browsers the canvas will simply be empty while
the rest of the page continues to work.

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

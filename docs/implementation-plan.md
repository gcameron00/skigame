# Implementation plan

This document describes how the holding site at **caitlincameron.ski** is
built and what is intentionally out of scope. It is intended to be short
enough to read in one sitting.

## Goals

1. Tell visitors, politely, that the real site is not yet available.
2. Show the message in **German first, then English**.
3. Offer a small, optional slalom mini-game so the page feels friendly
   rather than empty.
4. Be trivial to host on Cloudflare Pages: static files only.

## Non-goals

- No framework, bundler, package.json or build step.
- No analytics, tracking, or third-party scripts.
- No user accounts, forms, newsletter sign-ups, or backend.
- No attempt to make the game competitive — no leaderboards, no scoring
  beyond a running "gates cleared" count.
- The game must **never dominate** the page — the coming-soon message is
  the primary content.

## Pages

| Path        | File                | Purpose                                  |
| ----------- | ------------------- | ---------------------------------------- |
| `/`         | `index.html`        | Bilingual coming-soon notice + game.     |
| `/about/`   | `about/index.html`  | Short description of the holding site.   |

A 404 page is deliberately omitted for now — Cloudflare Pages serves a
sensible default and the site is only two pages.

## Layout of the home page

Top-to-bottom on `index.html`:

1. **Header**: small wordmark / site name.
2. **German message** (`<section lang="de">`)
   - Heading: _Bald verfügbar_
   - Body: short, polite paragraph explaining the site is on its way.
3. **English message** (`<section lang="en">`)
   - Heading: _Coming soon_
   - Body: the English translation of the German paragraph.
4. **Game** (`<section>` with `<canvas>`)
   - A heading making clear it is "just for fun".
   - The canvas itself, sized modestly (not full-viewport).
   - Brief one-line instructions.
5. **Footer**: copyright line with the current year.

This vertical order means the coming-soon message is always above the
fold, even on small screens; the game requires deliberate scrolling and so
cannot obscure the notice.

## Styling

- Single stylesheet at `assets/css/styles.css`.
- Light + dark mode via `prefers-color-scheme`.
- Neutral, alpine-inspired palette (whites, slate, a single accent blue).
- System font stack — no web font downloads.
- Layout is a centred single column with a max content width of roughly
  `42rem` so paragraphs stay readable.

## The slalom mini-game

The game lives in `assets/js/slalom.js` and renders into a single
`<canvas>` element on `index.html`.

### Mechanics

- A skier slides down a scrolling slope from top to bottom of the canvas.
- Pairs of red and blue gates appear at intervals. The player steers the
  skier left/right to pass between each pair.
- Counter for gates cleared and gates missed; on collision with a pole the
  skier briefly flashes and the missed counter increments — the game does
  not end, so visitors can leave it running.
- Difficulty is constant (no speed ramp) so the game stays low-stakes.

### Controls

- Keyboard: `←` / `→` (and `A` / `D`) to steer.
- Touch / pointer: drag horizontally anywhere on the canvas.
- Pause / resume button below the canvas.

### Accessibility considerations

- The canvas is decorative and labelled as such — every meaningful piece
  of information on the page is also available as plain HTML text above
  the canvas.
- The game does **not** auto-start; the user must press the _Start_
  button. This avoids unsolicited motion for users who arrive with
  `prefers-reduced-motion: reduce`. The button itself is honoured even
  when reduced motion is requested, because it is an explicit user
  action.
- Score numbers are updated in the DOM (not just drawn on the canvas)
  inside an `aria-live="polite"` region so screen-reader users get the
  same feedback.

### File budget

- `slalom.js` is a single, dependency-free module, hand-written and
  commented sparingly. Target: well under 10&nbsp;KB minified-equivalent
  (we ship it unminified).

## Cloudflare Pages configuration

- Static deployment, no build command, output directory = repo root.
- `_headers` sets long cache lifetimes for `/assets/*` and a short
  lifetime for HTML, plus a few baseline security headers
  (`X-Content-Type-Options`, `Referrer-Policy`).

## Future work (out of scope for this PR)

- Swap the holding site for the real `caitlincameron.ski` site when it is
  ready. The expectation is that this whole repository is replaced or its
  `index.html` is repointed at that point.
- Optional: a "subscribe to be notified" form, only if Caitlin asks for it.

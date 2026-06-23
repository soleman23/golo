# GoLo Golf App — Design System

**Canonical reference: `Golo Golf - Design System.dc.html`** — open it before building any new page. It documents every token, type style, surface and component below, rendered live.

## Aesthetic: "glass over turf"
Dark, full-bleed golf photography base + frosted-glass surfaces + oversized numerals + one electric-lime accent. Every screen layers a course photo (`assets/`) under a 180° dark scrim, with translucent glass on top. Never use a flat opaque background.

## Core tokens
- **Accent (lime):** `#d4f23a` — the one accent. Text on it = `#13250a`. Exposed as an `accent` prop on every page; derive tints with a `hexA(hex, alpha)` helper, never hard-code alpha variants.
- **Turf base (phone):** `radial-gradient(120% 80% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)`
- **Page base (desktop canvas):** `radial-gradient(130% 90% at 50% -10%, #1c2a22 0%, #12161a 55%, #0c0f12 100%)`
- **Positive** `#bef264` · **Negative** `#fb7185` · **Neutral** `rgba(255,255,255,.7)`
- **Player palette (assigned in join order):** `#2dd4bf #60a5fa #fb923c #c084fc #f472b6 #facc15`
- **Text on dark:** primary `#fff`, secondary `rgba(255,255,255,.62)`, tertiary `.5`, muted `.4`

## Glass surfaces
- Card/sheet: `rgba(20,28,24,.5)` + `blur(20px)`, border `rgba(255,255,255,.13)`
- Chrome/pill: `rgba(255,255,255,.13)` + `blur(10px)`, border `.18`
- Nav bar: `rgba(16,22,18,.7)` + `blur(18px)`
- Bottom sheet: `rgba(14,20,16,.9)` + `blur(26px)`

## Type (system-ui, no web fonts)
Weights run heavy: 800 structural (headings/labels/numerals/buttons), 700 sub-text, 600 muted body. Display numerals huge; section labels 11px/800/1.4px UPPERCASE; kicker 12px/800/2–3px accent.

## Shape
Phone shell 48px · card/sheet 20–24px · tile/control 14–16px · small button 10–11px · pill 9999px. Tap targets ≥48px.

## Conventions
- **Shared round state:** Setup writes the round to `localStorage["golo:round"]` (course, tees, players, format, bets); Scoring + You read it back.
- **Phone canvas:** fixed 390×844; desktop showcase 1080px centered, 44–56px padding, blurred lime halo behind device.
- **Bottom tab nav:** Home / Rounds / Play / You. Active tab = lime-tint bg + lime icon+label; hrefs are URL-encoded filenames.
- **Lower is better:** shorter bars / lower numbers / lime = better score; over-par + losses = rose `#fb7185`.
- **User imagery:** `image-slot.js` component (`shape="circle"`), unique `id` per slot so drops persist.

## Pages
Home · Round Setup · Scoring (Immersive) · Leaderboard · Payout · You · Onboarding · Design System

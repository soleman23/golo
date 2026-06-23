# Handoff: GoLo Wordmark & Logo System

## Overview
The GoLo brand mark — a light, staggered "GoLo" wordmark where both **o**'s are
rendered as dimpled golf balls. The trailing ball always carries the single hit of
brand lime. This package documents the primary lockup plus its color variants, the
app-icon set, and the nav lockup so they can be rebuilt as real assets (SVG/React
component) in the GoLo codebase.

## About the Design Files
The file in this bundle (`Golo Golf - Logo.dc.html`) is a **design reference created
in HTML** — a live prototype showing the intended construction, proportions, and
color treatment of the logo. It is **not production code to ship directly**. The task
is to recreate this mark in the target environment: most likely as a single
parametric **SVG** (or a small React component that emits SVG) so it scales cleanly
and the accent color stays themeable. If you only need a static asset, export the
primary lockup and the app icon to SVG/PNG at the sizes below.

## Fidelity
**High-fidelity.** Final colors, weights, proportions, and stagger geometry are locked.
Rebuild pixel-accurately. All geometry below is expressed as ratios of the cap
font-size (`F`) so it scales to any size.

## The Construction
The wordmark is two stacked clusters, laid out left-to-right with the second cluster
nudged down and right so it nests under the first:

```
 Cluster A (top):     "G" + white golf ball        (the "Go")
 Cluster B (bottom):  "L" + lime  golf ball        (the "Lo")
```

- Both clusters are `display:flex; align-items:flex-end`.
- The letters are thin caps; the balls sit just above the baseline, reading as the
  lowercase **o**.
- Cluster B is shifted **down and right** and given a higher z-index so the **"L"
  renders in front of / overlapping the white ball of Cluster A**. This overlap is
  intentional and is the signature of the mark.

### Geometry (ratios of cap font-size `F`)
| Value | Ratio | At F = 148px (primary) |
|---|---|---|
| Cap font-size | `F` | 148px |
| Cap font-weight | — | **300** |
| Cap letter-spacing | — | **−0.02em** |
| Ball diameter | `0.465 · F` | 69px |
| Ball padding-bottom (lift above baseline) | `0.068 · F` | 10px |
| Gap between cap and its ball | `0.014 · F` (min 1px) | 2px |
| Cluster B vertical drop (`margin-top`) | `0.15 · F` | 22px |
| Cluster B horizontal nudge (`margin-left`) | `0.10 · F` | 15px |
| Cluster B `z-index` | 2 (above cluster A) | — |

> Note: in the primary lockup the cluster gap/lift were hand-tuned to 2px / 10px,
> which match the ratios above at F = 148. Use the ratios for any other size.

### The golf ball
An SVG circle on a `0 0 100 100` viewBox:
- **Body:** radius 48, filled with `fill`. When `highlight` is on, the fill is a
  radial gradient `cx 34% / cy 26% / r 78%`: stop 0% `#ffffff`, stop 42% `fill`,
  stop 100% `fill` (soft top-left sheen). When off, flat `fill`.
- **Dimples:** 8 small circles, radius 4.2, color = `dimple`, at these (x,y) fractions
  of 100: `(50,30) (34,42) (66,42) (28,62) (50,55) (72,62) (40,74) (60,74)`.

## Variants

### Primary mark (on dark / on turf)
- "G" and "L": `#ffffff`
- First ball: white, **highlight on**, dimple `rgba(20,40,24,.32)`
- Second ball: **lime `#d4f23a`**, highlight on, dimple `rgba(19,37,10,.5)`
- Sits over a turf radial + a blurred lime glow halo (presentation only).

### Lockup — mono lime (on near-black `#0c0f12`)
- Caps + both balls: lime `#d4f23a`, **highlight off**, dimple `rgba(12,15,18,.55)`.

### Lockup — mono white (on glass / dark)
- Caps + both balls: `#ffffff`, highlight on, dimple `rgba(20,40,24,.3)`.

### Lockup — on light (`#f4f5f0`)
- Caps: `#13250a`. Balls: white, highlight off, dimple `rgba(19,37,10,.45)`.

### Nav lockup
- Same as mono white, at `F = 30px`, inside the glass nav pill.

## App Icon & Avatar set
- **App icon · 132px:** rounded-square 30px radius, turf radial
  `radial-gradient(125% 110% at 30% 15%, #2a7d4a 0%, #14532d 55%, #0a2418 100%)`,
  centered **single white golf ball** (80px, highlight on). This is the standalone
  icon glyph.
- **Lime icon · 96px:** 24px radius, solid `#d4f23a` background, a dark "Go" lockup
  (cap `#13250a`, 46px/800, ball 28px dark with lime dimples).
- **Favicon · 64px:** 16px radius, `#0c0f12`, single lime ball (36px, highlight off).
- **Favicon · 40px:** 11px radius, solid lime, single dark ball (22px).

## Design Tokens
| Token | Value |
|---|---|
| Accent (lime) | `#d4f23a` |
| Text on lime | `#13250a` |
| Turf radial (icon) | `radial-gradient(125% 110% at 30% 15%, #2a7d4a 0%, #14532d 55%, #0a2418 100%)` |
| Page base (showcase) | `radial-gradient(130% 90% at 50% -10%, #1c2a22 0%, #12161a 55%, #0c0f12 100%)` |
| Primary panel turf | `radial-gradient(120% 90% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 90%)` |
| Font | `system-ui` (no web font) |
| Cap weight | 300 |
| Radii | icon 30 · lockup 24 · favicon 16 · 11 |

The accent is the **only** tunable color — in the prototype it's an `accent` prop
(default `#d4f23a`); tint variants are derived via an alpha helper, never hardcoded.
Expose it the same way in code so the brand color stays themeable.

## Assets
No external image assets — the mark is 100% vector (SVG balls + system-ui text).
Recreate as SVG. No icon library or font download required.

## Files
- `Golo Golf - Logo.dc.html` — the live design reference. The `ball()` and `word()`
  methods in its script block contain the exact geometry; `renderVals()` defines the
  primary mark and every variant listed above.

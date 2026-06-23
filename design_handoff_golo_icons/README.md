# Handoff: GoLo Custom Icon Set

## Overview
This package contains the **custom icon set** built for the GoLo golf app — 12 solid
glyph icons (skins, nassau, purse, closest-to-pin, etc.) plus one two-tone "check"
icon used in feature bullets. These are hand-drawn SVG marks specific to GoLo's
betting/scoring vocabulary; they are not from any icon library.

This is a **scoped handoff: icons only.** It does not include the app screens — just
the artwork and the code to add these icons to your codebase.

## About the Files
The icons here are **production-ready assets**, not throwaway prototype markup:
- `svg/*.svg` — one standalone SVG per icon, ready to drop into any project.
- `GoloIcons.jsx` — a small React component that renders any icon by name.

You can use either path. Recreate/import them using your codebase's existing
conventions (an icon component, an SVG sprite, an `@svgr` import, etc.).

## Fidelity
**High-fidelity.** Final geometry — use the paths exactly as provided. Every glyph is
drawn on a **24×24 viewBox** and paints with `fill: currentColor`, so it inherits the
surrounding text color. The check icon is the one exception (see below).

## The Icons

| Semantic name   | Glyph key | What it marks                         |
|-----------------|-----------|---------------------------------------|
| `skins`         | target    | Skins game / accuracy                 |
| `nassau`        | trophy    | Nassau / a win                        |
| `purse`         | cash      | Stroke purse / money in the pot       |
| `closestToPin`  | pin       | Closest-to-pin / a location           |
| `longestDrive`  | drive     | Longest drive                         |
| `birdie`        | bird      | Birdie                                |
| `streak`        | flame     | Hot streak                            |
| `swap`          | swap      | Net ↔ gross toggle / swap             |
| `scorecard`     | card      | Scorecard                             |
| `leader`        | crown     | Leader / overall winner               |
| `wager`         | dice      | Wager / Wolf pick                     |
| `wolf`          | wolf      | Wolf game                             |
| `check`         | check     | Feature-bullet checkmark (two-tone)   |

> The codebase referenced glyphs by their raw key (`target`, `trophy`, …). The React
> component also exposes friendlier **semantic names** (`ICON_NAMES`) — prefer those
> in product code so usage reads clearly. Both resolve to the same artwork.

## How to use

### Option A — React component (recommended)
Copy `GoloIcons.jsx` into your project, then:

```jsx
import { Icon, CheckIcon } from './GoloIcons';

<Icon name="skins" size={20} />                 // inherits text color
<Icon name="leader" size={16} color="#d4f23a" /> // explicit lime
<CheckIcon />                                    // lime two-tone check
```

- `size` defaults to `24`; pass any number for px.
- `color` defaults to `currentColor` — usually leave it off and let the icon inherit
  the parent's text color. Pass a hex only when you want to override (e.g. the
  multi-color money rows on the landing page use `#facc15`, `#bef264`, `#60a5fa`).

### Option B — Static SVG files
Each `svg/<name>.svg` is a standalone 24×24 file with `fill="currentColor"`. Set the
color from CSS (`color:` on the element / parent) or via your SVG-loader. The
`check.svg` ships with the lime accent baked in.

## The check icon (special case)
Unlike the glyphs, `check` is a **two-tone outline**, not a single filled path:
- Background circle: `r=11`, fill = accent @ **16%** opacity, stroke = accent @ **50%**
  opacity, stroke-width `1.4`.
- Check mark: path `M7.5 12.4l3 3 6-6.4`, stroke = accent, stroke-width `2.2`,
  round caps + joins.

In the prototype the accent is themeable, so the component derives the two faded tints
from the base color with an alpha helper (`hexA`) rather than hardcoding them. Keep
that pattern if your accent is configurable.

## Design Tokens
| Token             | Value     | Notes                                            |
|-------------------|-----------|--------------------------------------------------|
| Accent (lime)     | `#d4f23a` | Default icon tint; the brand's single accent.    |
| Grid / viewBox    | `24 × 24` | All icons.                                        |
| Default fill      | `currentColor` | Glyphs inherit text color.                  |
| Check circle fill | accent @ 0.16 | Derived via alpha, not hardcoded.            |
| Check stroke      | accent @ 0.50 | Derived via alpha.                           |

Other accent colors used alongside these icons on the landing page (for reference):
gold `#facc15`, soft-lime `#bef264`, blue `#60a5fa`.

## Files
- `GoloIcons.jsx` — React icon component (`Icon`, `CheckIcon`, `ICON_NAMES`).
- `svg/*.svg` — 13 standalone SVG files (12 glyphs + `check.svg`).

## Source
These icons live inline in `Golo Golf - Landing Page.dc.html` — the `ICONS` map plus
the `ico()` and `check()` helpers in its script block. This package extracts them into
reusable assets; nothing else is needed.

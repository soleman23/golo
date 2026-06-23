# GoLo App Header — wiring handoff

A reusable header component already exists at **`Golo Golf - App Header.dc.html`**.
Goal: mount it on each phone page in place of that page's hand-rolled top bar. Structure is final — do **not** redesign the header, only wire it onto pages.

---

## 1. The component (already in the project — source for reference)

`Golo Golf - App Header.dc.html` renders: **status bar → nav row (`‹ back` · centered GoLo · `pin` menu) → title row (kicker + title + optional context pill)**. It has a built-in dropdown menu opened by the pin.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<div style="color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.4);">

  <!-- status bar -->
  <div style="height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:13px;font-weight:700;">
    <span>9:41</span>
    <span style="display:flex;align-items:center;gap:6px;"><span>5G</span><span style="display:inline-block;width:23px;height:11px;border:1.5px solid #fff;border-radius:3px;position:relative;"><span style="position:absolute;left:1.5px;top:1.5px;bottom:1.5px;right:6px;background:#fff;border-radius:1px;"></span></span></span>
  </div>

  <!-- nav bar: [back]  [logo]  [action] -->
  <div style="position:relative;display:flex;align-items:center;gap:8px;padding:2px 14px 0;min-height:48px;">

    <!-- back: bare lime chevron -->
    <a href="{{ backHref }}" style="flex:0 0 auto;width:40px;height:40px;display:flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;">
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.4));"><path d="M15 4.5l-7.2 7.5 7.2 7.5" stroke="{{ accent }}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </a>

    <!-- centered logo -->
    <div style="flex:1;display:flex;align-items:center;justify-content:center;min-width:0;">
      <sc-if value="{{ isPin }}" hint-placeholder-val="{{ true }}">
        <svg width="35" height="36" viewBox="0 0 120 124" fill="none" style="display:block;filter:drop-shadow(0 4px 11px rgba(0,0,0,.5));"><path d="M56 20 A40 40 0 1 0 95.8 64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></path><line x1="95.8" y1="64" x2="64" y2="64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></line><circle cx="56" cy="58" r="15" fill="#fff"></circle><circle cx="56" cy="58" r="9" fill="none" stroke="rgba(10,36,24,0.28)" stroke-width="2.4"></circle><line x1="56" y1="44" x2="56" y2="14" stroke="{{ accent }}" stroke-width="3.4"></line><path d="M56 14 L86 22 L56 34 Z" fill="#fff"></path></svg>
      </sc-if>
      <sc-if value="{{ isLockup }}" hint-placeholder-val="{{ false }}">
        <span style="display:flex;align-items:center;gap:9px;filter:drop-shadow(0 3px 9px rgba(0,0,0,.45));">
          <svg width="25" height="26" viewBox="0 0 120 124" fill="none" style="display:block;flex:0 0 auto;"><path d="M56 20 A40 40 0 1 0 95.8 64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></path><line x1="95.8" y1="64" x2="64" y2="64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></line><circle cx="56" cy="58" r="15" fill="#fff"></circle><circle cx="56" cy="58" r="9" fill="none" stroke="rgba(10,36,24,0.28)" stroke-width="2.4"></circle><line x1="56" y1="44" x2="56" y2="14" stroke="{{ accent }}" stroke-width="3.4"></line><path d="M56 14 L86 22 L56 34 Z" fill="#fff"></path></svg>
          <span style="font-size:23px;font-weight:800;letter-spacing:-0.6px;line-height:1;"><span style="color:#fff;">Go</span><span style="color:{{ accent }};">Lo</span></span>
        </span>
      </sc-if>
      <sc-if value="{{ isWord }}" hint-placeholder-val="{{ false }}">
        <span style="display:flex;align-items:center;gap:11px;filter:drop-shadow(0 3px 9px rgba(0,0,0,.45));">
          <svg width="30" height="31" viewBox="0 0 120 124" fill="none" style="display:block;flex:0 0 auto;"><path d="M56 20 A40 40 0 1 0 95.8 64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></path><line x1="95.8" y1="64" x2="64" y2="64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></line><circle cx="56" cy="58" r="15" fill="#fff"></circle><circle cx="56" cy="58" r="9" fill="none" stroke="rgba(10,36,24,0.28)" stroke-width="2.4"></circle><line x1="56" y1="44" x2="56" y2="14" stroke="{{ accent }}" stroke-width="3.4"></line><path d="M56 14 L86 22 L56 34 Z" fill="#fff"></path></svg>
          <span style="font-size:15px;font-weight:800;letter-spacing:3.5px;color:#fff;">GOLO</span>
        </span>
      </sc-if>
      <sc-if value="{{ isWordmark }}" hint-placeholder-val="{{ false }}">
        <span style="font-size:25px;font-weight:800;letter-spacing:-0.6px;line-height:1;filter:drop-shadow(0 3px 9px rgba(0,0,0,.45));"><span style="color:#fff;">Go</span><span style="color:{{ accent }};">Lo</span></span>
      </sc-if>
    </div>

    <!-- right action (balances the back chevron) -->
    <div style="flex:0 0 auto;width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
      <sc-if value="{{ rightHelp }}" hint-placeholder-val="{{ true }}">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.4));"><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.62)" stroke-width="1.8"></circle><path d="M9.4 9.1a2.6 2.6 0 0 1 4.8 1.3c0 1.7-2.2 2-2.2 3.4" stroke="rgba(255,255,255,.62)" stroke-width="1.8" stroke-linecap="round"></path><circle cx="12" cy="17" r="1.1" fill="rgba(255,255,255,.62)"></circle></svg>
      </sc-if>
      <sc-if value="{{ rightMenu }}" hint-placeholder-val="{{ false }}">
        <svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.4));"><g fill="rgba(255,255,255,.65)"><circle cx="12" cy="5" r="1.9"></circle><circle cx="12" cy="12" r="1.9"></circle><circle cx="12" cy="19" r="1.9"></circle></g></svg>
      </sc-if>
      <sc-if value="{{ rightPin }}" hint-placeholder-val="{{ false }}">
        <button onClick="{{ toggleMenu }}" aria-label="Open menu" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:0;">
          <svg width="28" height="29" viewBox="0 0 120 124" fill="none" style="display:block;filter:drop-shadow(0 3px 9px rgba(0,0,0,.5));"><path d="M56 20 A40 40 0 1 0 95.8 64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></path><line x1="95.8" y1="64" x2="64" y2="64" stroke="{{ accent }}" stroke-width="12" stroke-linecap="round"></line><circle cx="56" cy="58" r="15" fill="#fff"></circle><circle cx="56" cy="58" r="9" fill="none" stroke="rgba(10,36,24,0.28)" stroke-width="2.4"></circle><line x1="56" y1="44" x2="56" y2="14" stroke="{{ accent }}" stroke-width="3.4"></line><path d="M56 14 L86 22 L56 34 Z" fill="#fff"></path></svg>
        </button>
      </sc-if>
    </div>

    <!-- pin menu dropdown -->
    <sc-if value="{{ menuOpen }}" hint-placeholder-val="{{ false }}">
      <div style="position:absolute;top:48px;right:12px;z-index:60;min-width:188px;background:rgba(14,20,16,.92);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.16);border-radius:16px;overflow:hidden;box-shadow:0 20px 46px rgba(0,0,0,.55);text-shadow:none;">
        <sc-for list="{{ menuItems }}" as="m" hint-placeholder-count="4">
          <a href="{{ m.href }}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;text-decoration:none;color:#fff;font-size:14px;font-weight:700;border-bottom:{{ m.divider }};">{{ m.label }}<span style="color:{{ accent }};font-size:14px;font-weight:800;display:{{ m.dotShow }};">●</span></a>
        </sc-for>
      </div>
    </sc-if>
  </div>

  <!-- title row -->
  <sc-if value="{{ showTitle }}" hint-placeholder-val="{{ true }}">
    <div style="padding:8px 18px 12px;">
      <sc-if value="{{ hasKicker }}" hint-placeholder-val="{{ true }}">
        <div style="font-size:12px;font-weight:800;letter-spacing:2px;color:{{ accent }};">{{ kicker }}</div>
      </sc-if>
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.4px;line-height:1.12;margin-top:2px;">{{ title }}</div>
      <sc-if value="{{ hasPill }}" hint-placeholder-val="{{ false }}">
        <div style="display:flex;margin-top:10px;">
          <span style="display:inline-flex;align-items:center;gap:7px;max-width:100%;background:rgba(255,255,255,.13);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.16);padding:6px 13px;border-radius:9999px;font-size:12px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span style="width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:{{ accent }};"></span>{{ contextPill }}</span>
        </div>
      </sc-if>
    </div>
  </sc-if>

</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":170},"accent":{"editor":"color","default":"#d4f23a","tsType":"string"},"backHref":{"editor":"text","default":"#","tsType":"string"},"kicker":{"editor":"text","default":"WE'RE HERE","tsType":"string"},"title":{"editor":"text","default":"Contact support","tsType":"string"},"contextPill":{"editor":"text","default":"","tsType":"string"},"logo":{"editor":"enum","default":"wordmark","options":["pin","lockup","pinWord","wordmark"],"tsType":"string"},"showTitle":{"editor":"boolean","default":true,"tsType":"boolean"},"rightAction":{"editor":"enum","default":"pin","options":["help","menu","pin","none"],"tsType":"string"},"currentPage":{"editor":"text","default":"Contact support","tsType":"string"}}'>
class Component extends DCLogic {
  state = { menuOpen: false };
  accentColor(){ return this.props.accent ?? '#d4f23a'; }
  menuList(){
    const cur = this.props.currentPage ?? '';
    const items = [
      { label:'Home',            href:'Golo%20Golf%20-%20Home.dc.html' },
      { label:'You',             href:'Golo%20Golf%20-%20You.dc.html' },
      { label:'Contact support', href:'Golo%20Golf%20-%20Contact.dc.html' },
    ];
    return items.map((it,i)=>({
      label: it.label, href: it.href,
      divider: i < items.length-1 ? '1px solid rgba(255,255,255,.08)' : 'none',
      dotShow: it.label === cur ? 'inline' : 'none',
    }));
  }
  renderVals(){
    const accent = this.accentColor();
    const logo = this.props.logo ?? 'pin';
    const ra = this.props.rightAction ?? 'help';
    const kicker = this.props.kicker ?? '';
    const contextPill = this.props.contextPill ?? '';
    return {
      accent,
      backHref: this.props.backHref ?? '#',
      kicker, hasKicker: !!String(kicker).trim(),
      contextPill, hasPill: !!String(contextPill).trim(),
      title: this.props.title ?? '',
      showTitle: (this.props.showTitle ?? true) && String(this.props.showTitle) !== 'false',
      isPin: logo === 'pin', isLockup: logo === 'lockup', isWord: logo === 'pinWord', isWordmark: logo === 'wordmark',
      rightHelp: ra === 'help', rightMenu: ra === 'menu', rightPin: ra === 'pin',
      menuOpen: this.state.menuOpen,
      toggleMenu: ()=>this.setState(s=>({ menuOpen: !s.menuOpen })),
      menuItems: this.menuList(),
    };
  }
}
</script>
</body>
</html>
```

---

## 2. Prop reference

| Prop | Values | Notes |
|---|---|---|
| `accent` | color (default `#d4f23a`) | pass the page's own `{{ accent }}` |
| `back-href` | URL-encoded filename | left chevron target |
| `logo` | `pin` · `lockup` · `pinWord` · `wordmark` | **standard = `wordmark`** (GoLo text centered) |
| `right-action` | `help` · `menu` · `pin` · `none` | **standard = `pin`** (opens the dropdown menu) |
| `kicker` | text | small lime label above the title |
| `title` | text | 22px page title |
| `context-pill` | text | optional glass pill under the title (course / live context) — hidden when empty |
| `show-title` | boolean (default true) | set `false` for a bar-only header |
| `current-page` | menu label | dots the matching item in the menu (`Home`, `You`, `Contact support`) |

> dc-import attributes are kebab-case and map to camelCase props (`back-href` → `backHref`). All `href`s are URL-encoded filenames (`Golo%20Golf%20-%20You.dc.html`).

---

## 3. Wiring steps (per page)

1. **Delete the page's own status bar** — the `<!-- status bar -->` block containing `9:41 / 5G`. The header renders its own; leaving it = **double status bar**.
2. **Delete the page's hand-rolled top bar / kicker+title block.**
3. **Insert the header as the first child of the phone's content flex column:**
   ```html
   <dc-import name="Golo Golf - App Header" accent="{{ accent }}"
     back-href="<URL-encoded prev page>" logo="wordmark" right-action="pin"
     kicker="<page kicker>" title="<page title>" context-pill="<course/live or omit>"
     current-page="<menu label or omit>"
     hint-size="100%,170px" style="flex:0 0 auto;display:block;"></dc-import>
   ```
4. **Keep each page's functional sub-rows** (progress bar, hole stepper, THROUGH counter, profile block) directly **below** the header — move any displaced course pill into `context-pill`, and any displaced right-side action (avatar/share/edit) into the menu or a small element just below.
5. **Fit / no horizontal scroll** — the phone scroll body must:
   - have `class="golo-scroll"` and `overflow-x:hidden`,
   - and the page `<helmet><style>` must define:
     ```css
     .golo-scroll::-webkit-scrollbar{ display:none; }
     .golo-scroll{ -ms-overflow-style:none; scrollbar-width:none; }
     ```
   - Any row using `width:100%` **with padding** must also get `box-sizing:border-box`, or it computes ~28px too wide.
6. **Menu destinations** live in the component's `menuList()` (`Home` / `You` / `Contact support`). Edit there to add more.

---

## 4. Per-page values (already applied — use to verify / replicate)

| Page | back-href → | kicker | title | context-pill | current-page |
|---|---|---|---|---|---|
| Home | Landing Page | `{{ M.dateKicker }}` | `{{ M.greeting }}` | — | `Home` |
| Setup | Home | `{{ M.headerKicker }}` | `{{ M.stepTitle }}` | `{{ M.coursePill }}` | — |
| Scoring (Immersive) | Home | `LIVE ROUND` | `Scoring` | `{{ courseName }}` | — |
| Leaderboard | Scoring (Immersive) | `LIVE` | `Leaderboard` | `{{ M.courseName }}` | — |
| Payout | Leaderboard | `FINAL · {{ M.scoringLabel }}` | `Settle Up` | `{{ M.courseName }}` | — |
| You | Home | `GOLO GOLF · YOU` | `Your locker` | — | `You` |
| Contact | You | `WE'RE HERE` | `Contact support` | — | `Contact support` |

All use `logo="wordmark"` and `right-action="pin"`.

---

## 5. Paste-prompt for Cursor

> Use the existing `Golo Golf - App Header.dc.html` component (do not redesign it). On each phone page, replace the page's own status bar + hand-rolled top bar with a `<dc-import name="Golo Golf - App Header" …>` per the wiring steps and per-page values in `HEADER_HANDOFF.md`. Standard config is `logo="wordmark"`, `right-action="pin"`. Remove the page's original status bar (the header includes one). Keep every functional sub-row below the header; move displaced course pills into `context-pill` and displaced right-side actions into the menu or just below. Ensure each scroll body has `class="golo-scroll"` + `overflow-x:hidden`, the `.golo-scroll` CSS is in the helmet, and any `width:100%`+padding row uses `box-sizing:border-box`. Don't touch anything below the header.

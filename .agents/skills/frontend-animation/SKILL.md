---
name: frontend-animation
description: >
  Animate any concept, process, or workflow as an interactive HTML demo. Trigger on:
  "animate this", "show me how this works", "make a visual", "explain this visually",
  "build a simulation", "walk me through". Works for any domain — finance, education,
  AI, software, networking, science, business. If it has steps, it can be animated.
  Output: single self-contained HTML file, no external JS.
---

# Frontend Animation Skill

Turn any concept, process, or workflow into a polished, animated HTML demo. Domain-agnostic.

---

## Process Overview

1. **Identify domain & narrative** — what story, who's the audience, what's the key insight?
2. **Choose best UI representation** — what visual makes this clearest?
3. **Map the flow** — stages, branches, loops, parallel tracks
4. **Choose layout tier** — single flow / multi-snippet / simulation / mockup
5. **Assign timings** — paced for the viewer, not for realism
6. **Build the HTML** — self-contained, vanilla JS only
7. **Self-review** — run every checklist item before saving

---

## Step 1 — Identify Domain & Narrative

Answer before writing code:
- What domain? (finance, CS, biology, product, networking, …)
- Who's the audience? (student, developer, investor, general user)
- What's the one thing they should understand after watching?

| Domain | Natural metaphor | Accent |
|---|---|---|
| AI / LLM / agent | Chat + execution trace | Indigo `#6366f1` |
| Software / DevOps | Pipeline / terminal | Slate `#475569` |
| Finance / trading | Ticker + ledger | Emerald `#059669` |
| Education / CS | Whiteboard / step-by-step | Amber `#d97706` |
| Networking | Packet flow / handshake | Sky `#0ea5e9` |
| Science / biology | Diagram + labels | Teal `#0d9488` |
| Business / product | Kanban / funnel | Violet `#7c3aed` |
| Real app / product UI | Screen mockup (Tier E) | match app brand |
| Everyday / general | Story cards | Rose `#e11d48` |

---

## Step 2 — Choose the Best UI Representation

**Do not default to a chat window.** Ask: *"What visual would make this clearest to someone seeing it for the first time?"* Pick the representation that serves understanding, then state the choice in one sentence before writing HTML.

| # | Signal in the request | Best representation |
|---|---|---|
| 1 | Real, recognisable interface (app, website, checkout, dashboard) | **Screen Mockup** — replica of the real UI, animate screen transitions |
| 2 | Back-and-forth conversation or request-response | **Chat + Execution Trace** — chat window with internal step block |
| 3 | Things moving through stages / pipeline | **Pipeline / Board** — horizontal or vertical stage flow |
| 4 | Numbers or state changing over time (sort, price, balance) | **Simulation / Canvas** — live state with play/pause/step |
| 5 | Two-party protocol or handshake | **Sequence Diagram** — two columns with animated arrows |
| 6 | Branching decision or guided process | **Flowchart / Step Cards** — yes/no branches, step-by-step reveal |
| 7 | Story, comparison, or general explainer | **Story Cards** — sequential reveal with supporting visuals |

---

## Step 3 — Map the Flow

Produce a named stage list before writing any code:
- **Trigger** — what starts the process?
- **Stages** — every logical step, named concisely
- **Branches** — conditional paths labeled (`yes/no`, `hit/miss`)
- **Loops** — repeat cycles with count
- **Parallel tracks** — concurrent operations (fan-out / fan-in)
- **Terminal state** — what does "done" look like?

**Example — Amazon order (Screen Mockup):**
```
[Click: Buy Now]
  → Product Page: highlight "Buy Now" button    (600 ms)
  → Screen → Cart: item added, show cart        (500 ms)
  → Screen → Checkout: address form appears     (400 ms)
  → Fill Address: fields animate in             (800 ms)
  → Screen → Payment: card form                 (400 ms)
  → Screen → Confirm: order summary             (600 ms)
  → [Order placed — confirmation number shown]
```

**Example — Bubble Sort (Simulation):**
```
[Click: Sort]
  → Pass 1: compare pairs, swap if needed       (300 ms/pair)
  → Repeat passes until no swaps               
  → Highlight sorted array                      (400 ms)
  → [Done: N passes, M swaps]
```

---

## Step 4 — Choose Layout Tier

**Tier A — Single Flow** (default): one trigger → execution → result. Chat/story window.

**Tier B — Multi-Snippet**: sidebar (220 px) with named flows; one chat window per snippet.

**Tier C — Parallel Tracks**: fan-out header → nested concurrent rows → fan-in row. All start simultaneously, complete independently.

**Tier D — Simulation / Canvas**: `<canvas>` or DOM grid. Play / Pause / Step / Speed / Reset controls. Stats panel updates every frame.

**Tier E — Screen Mockup**: faithful replica of a real UI. No chat window — the screen IS the demo.
- Recreate the real UI structure (header, nav, product card, cart, form, modal, etc.)
- Each step transitions the screen to its next state with animation
- Highlight the active element (pulse/outline) before it triggers
- Progress breadcrumb at top: `Cart → Checkout → Payment → Confirmation`
- Realistic content: product names, prices, CSS-placeholder images, form fields

---

## Step 5 — Assign Timings

Timings serve the viewer, not production reality.

| Operation type | Duration |
|---|---|
| Instantaneous (validation, flag) | 80 – 200 ms |
| Fast computation / parse | 200 – 500 ms |
| Local I/O / cache | 300 – 700 ms |
| Network / API (fast) | 500 – 1 000 ms |
| Network / API (slow, LLM) | 1 500 – 4 000 ms |
| Human-paced step | 1 000 – 2 000 ms |
| Visual reveal / highlight | 400 – 800 ms |
| Simulation frame | 80 – 300 ms/frame |

- Loops: same duration per iteration, never speed up.
- Cap linear flows at ~25 s total. Simulations run until paused.
- Add ±15% jitter per run so replays feel live.

---

## Step 6 — Build the Animated HTML

Single self-contained file. All CSS + JS inline. **Vanilla JS only** — no React, Vue, D3, Chart.js, or any library. Google Fonts allowed via `<link>`.

### Critical Layout CSS (Tier A/B/C)

```css
html, body { height: 100%; margin: 0; }
.app { display: flex; flex-direction: column; height: 100vh; max-width: 760px; margin: 0 auto; }
.feed { flex: 1; overflow-y: auto; min-height: 0; /* REQUIRED */ padding: 20px 20px 12px; display: flex; flex-direction: column; gap: 4px; }
.input-bar { flex-shrink: 0; }
```

`min-height: 0` on `.feed` is mandatory — without it the input bar is pushed off-screen.

### Execution Block (Tier A/B/C)

```
│ ✓  Stage Name     Done      ✓  ⌄   │  done — click to expand
│ ⟳  Stage Name     Running…  ···    │  active — loader + label
│ –  Stage Name     Waiting   –      │  pending
```

- Row fade-in 0.25 s → loader + status → after duration: ✓ + "Done" + chevron
- Expanded row: `<pre>` with realistic mock payload
- Loop badge: amber pill `Loop 2`. Branch label: teal pill `→ Cache Hit`.
- Exec header: live stage label → `"N steps · Xs · key result"` on completion.

### Scroll Rules (Tier A/B/C) — Never Break These

```js
// After every feed.appendChild() — instant scroll
function scrollNow() { feed.scrollTop = feed.scrollHeight; }

// Only for the final result bubble — smooth reveal
function scrollSmooth() {
  requestAnimationFrame(() => requestAnimationFrame(() =>
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' })
  ));
}
```

- No `scrollIntoView` anywhere.
- `behavior:'smooth'` exactly once — final bubble only. Multiple smooth scrolls stack and freeze the viewport.
- No `feedEnd` sentinel div — use `feed.scrollHeight` directly.

### Loading Dots

```html
<div class="ld"><span></span><span></span><span></span></div>
<style>
.ld{display:inline-flex;gap:3px;align-items:center}
.ld span{width:5px;height:5px;border-radius:50%;background:var(--accent);animation:ldp 1s ease-in-out infinite}
.ld span:nth-child(2){animation-delay:.15s}.ld span:nth-child(3){animation-delay:.30s}
.ld.off{display:none}
@keyframes ldp{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}
</style>
```

### Design & Mock Data

- **One accent color per demo** (see domain table in Step 1). Shell bg: `#f9fafb`.
- **Fonts**: Inter (UI) · JetBrains Mono (code/numbers). No nav bars or chrome.
- Mobile-friendly at 380 px. No auto-play. Replay/Reset only after animation ends.
- Controls disabled while `busy = true` (except pause/step in Tier D).

**Mock data must be realistic for the domain — never use `...`, `lorem ipsum`, or `[value]`:**

| Domain | Example mock content |
|---|---|
| Finance | `$12,847.23`, `AAPL 182.40 ▲1.2%`, `7.00% APY` |
| Networking | `192.168.1.42`, `seq=1024 ack=1025`, `200 OK` |
| AI / LLM | model name, token counts, truncated output |
| Sorting | actual array values mutating per step, swap/compare count |
| Auth | `code=4/P7q…`, `access_token=ya29…`, ISO timestamps |
| Science | `pH 7.4`, `37°C`, `6.022×10²³`, element symbols |
| Product UI | real product names, prices, order numbers, addresses |

---

## Step 7 — Self-Review Checklist

Check every item before saving. Fix failures before outputting.

**Layout**
- [ ] `html, body { height: 100% }` present
- [ ] `.app`: `height: 100vh; display: flex; flex-direction: column`
- [ ] `.feed`: `flex: 1; overflow-y: auto; min-height: 0`
- [ ] `.input-bar` / controls: `flex-shrink: 0`
- [ ] No other element has `overflow: auto/scroll`

**Scroll (Tier A/B/C)**
- [ ] `scrollNow()` = `feed.scrollTop = feed.scrollHeight` — no `scrollIntoView`
- [ ] `scrollSmooth()` = double-rAF + `behavior:'smooth'` — called once only (final bubble)
- [ ] `scrollNow()` after every `feed.appendChild()` — no feedEnd div

**Animation / Simulation**
- [ ] Every stage from Step 3 present; active stage shows loader + status
- [ ] Completed stages: ✓, "Done", chevron, expandable detail
- [ ] Loop badges (amber); branch labels (teal); parallel fan-out/fan-in correct
- [ ] Tier D: play/pause/step/reset/speed all work; stats panel updates per frame
- [ ] Tier E: screen transitions animate; active element pulses; progress breadcrumb visible

**Content & Polish**
- [ ] No placeholder mock data; accent matches domain
- [ ] Replay/Reset appears only after animation ends
- [ ] Fully self-contained — no external JS; mobile works at 380 px

---

## Output

Save as `<topic-name>_animation.html` in the user's working directory.
Sandboxed: `/mnt/user-data/outputs/<topic-name>_animation.html`.
State the file path. Do not paste raw HTML in chat.

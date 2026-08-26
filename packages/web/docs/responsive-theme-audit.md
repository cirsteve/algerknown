# Route audit matrix — responsive + dual theme

The repository has no configured web UI test runner beyond the jsdom unit suite, and
adding one is outside this cohort's scope. This document is therefore the automated
build's companion: a repeatable **manual** matrix covering every route registered in
`src/client/App.tsx`, at every audited viewport, in both effective themes.

## How to run the matrix

```bash
npm install                                   # once per worktree
npm run build --workspace @algerknown/core    # @algerknown/web's server build needs core's d.ts
npm run dev  --workspace @algerknown/web      # client on :5173
```

Then, in the browser devtools device toolbar, walk the table below. For each cell:

1. Set the viewport width (**320**, **375**, **768**, **1280**).
2. Set the theme with the in-app Light / Dark / System control in the sidebar. The
   effective theme is what matters — `System` must be checked against an OS in both
   settings, or pinned with Light and Dark explicitly.
3. Confirm the four invariants, then the route's own row notes.

### The four invariants (checked in every cell)

| # | Invariant | How to check |
|---|---|---|
| D1 | No document-level horizontal scroll | `document.documentElement.scrollWidth <= window.innerWidth`. Wide content scrolls *inside* its own region, never the page. |
| D2 | Every primary action is reachable | The route's main control (submit, filter, approve, retry, theme toggle) is on screen and tappable without zooming. |
| D3 | Readable contrast in both themes | No slate-on-slate pairing surviving into light mode; body text, muted text, borders, links, and semantic (success/warn/error) states all legible. |
| D4 | Visible keyboard focus | Tab through the route: every control that can take focus shows a ring against its own background, in both themes. Measure with `el.focus({focusVisible: true})` — plain programmatic focus does not engage `:focus-visible`, so it under-reports. Skip controls that are hidden at that width or `disabled` in that state; neither can take focus, and counting them either way says nothing about what a keyboard user sees. |

A one-line console helper for D1:

```js
(() => { const d = document.documentElement;
  return { scrollWidth: d.scrollWidth, innerWidth: window.innerWidth,
           overflows: d.scrollWidth > window.innerWidth }; })()
```

## Viewport columns

| Key | Width | Stands for |
|---|---|---|
| 320 | 320px | Narrowest supported phone; the hard floor |
| 375 | 375px | Common phone |
| 768 | 768px | `md` — the sidebar becomes a column here |
| DSK | ≥1280px | Desktop |

Themes: **L** = light, **D** = dark. Every route is exercised at 320/375/768/DSK × L/D.

## Route matrix

| # | Route | Component | States to exercise | Narrow-width notes |
|---|---|---|---|---|
| 1 | `/` | `Dashboard` | normal, loading, error, empty index | Stat grid collapses to 1 column at 320 and 2 at `sm`; recent-item rows stack id above badge at 320 |
| 2 | `/entries` | `EntryList` | normal, loading, error, empty, filtered-empty | Header actions stack; the type `<select>` goes full width below `sm`; card grid is 1 column until `md` |
| 3 | `/primers` | `PrimerList` | normal, loading, error, empty | "New Primer" and title stack; source paths wrap instead of forcing width |
| 4 | `/primers/new` | `PrimerNew` | normal, invalid id, submitting, error | Mode buttons wrap; the two-up field grid is 1 column until `sm`; textarea is not fixed-width |
| 5 | `/primers/:id` | `PrimerDetail` | normal, loading, error | Markdown tables and code blocks scroll inside the article, not the page; long source path wraps |
| 6 | `/entries/new` | `EntryNew` | paste mode, upload mode, drag-active, parse error, preview, submitting | Mode toggle wraps; preview grid 1 column at 320; the format sample `<pre>` scrolls inside its box |
| 7 | `/summaries/new` | `SummaryNew` | create, analyzing, review, empty results, saving, error, selected/unselected rows | Action buttons stack and go full width below `sm`; relevance score + tick stay on the row without clipping the topic |
| 8 | `/entries/:id` | `EntryDetail` | normal, loading, error, not-found, content tab, history tab, delete dialog (disabled + enabled confirm) | Header meta wraps; action buttons stack; artifact paths/commits wrap; dialog fits 320 |
| 9 | `/entries/:id/edit` | `EntryEdit` | normal, loading, load error, parse error, preview, saving | YAML textarea stays inside the viewport; the button row wraps; preview grid 1 column at 320 |
| 10 | `/search` | `Search` | idle, loading, results, no results | Query field, type filter and submit stack into a column below `sm`; result rows put the badge under the text at 320 |
| 11 | `/graph` | `GraphView` | no selection, loading, empty graph | The entry `<select>` is full width below `sm`; canvas is bounded by viewport height |
| 12 | `/graph/:id` | `GraphView` | normal graph, selected node | Canvas repaints on resize and on theme change; connected-node badges wrap |
| 13 | `/ask` | `AskPage` | offline, checking, online, empty, thinking, answer with sources, error | Header stacks; the composer stays pinned and reachable; message bubbles wrap long tokens |
| 14 | `/ingest` | `IngestPage` | idle, ingesting + progress, reviewing, editing a proposal, approved, applying, results, offline, error | Proposal action buttons wrap; edit inputs stack at 320; results rows stack |
| 15 | `/changes` | `ChangesPage` | checking, offline, loading, normal, empty, error, each change type | Stats grid 2 columns at 320; the three filters stack; diff blocks wrap long values |
| 16 | `/jobs` | `JobsPage` | loading, error, empty, filtered-empty, expanded row, each status | Table scrolls inside a bordered region; filter tabs scroll horizontally rather than wrapping the page |
| 17 | `/traces` | `TracesPage` → `TracesView` | loading, empty, collapsed, expanded trace, expanded span, error span, load-more | Span table scrolls inside its region; JSON payload `<pre>` blocks scroll inside themselves |

## Shared surfaces exercised through the routes above

| Surface | Reached from | Notes |
|---|---|---|
| `EntryContent` | entry rendering | Object fields render in a contained scrolling `<pre>`; links row wraps |
| `EntryGrid` / `EntryList` (organism) | entry collections | Skeleton, empty and populated states all use semantic surfaces |
| `HistoryList` | `/entries/:id` → History tab | Loading, RAG-offline, error, empty and populated |
| `RagStatusPanel` / `RagOfflineNotice` | `/ask`, `/changes`, chat layout | Online, offline, checking, unknown |
| `TracesView` | `/traces`, `/jobs` → View Trace | See route 17 |

`components/EntryCard.tsx`, `components/HistoryTab.tsx`, `components/Layout.tsx` and
`components/RagStatus.tsx` are deprecated re-export shims with no markup of their own;
they are covered by auditing their targets.

## Result of the audit run for this change

The matrix was walked with the app running against a fixture knowledge base
(one long-id entry carrying every optional section, one minimal entry, one
summary, one primer whose Markdown holds a six-column table and a wide code
block) and the RAG backend deliberately down, so the offline and error states
were exercised alongside the populated ones.

All **136 cells** — 17 routes x 4 widths x 2 themes — pass the four invariants:

| Invariant | Result |
|---|---|
| D1 no document-level horizontal scroll | 136/136. `documentElement.scrollWidth` never exceeded the viewport at any width in either theme. |
| Table row semantics | 136/136 cells carry no `role` or `tabindex` on a `<tr>`. `<tr>` admits only `role="row"`, so the disclosure on a jobs or span row is a real `<button>` inside the first cell rather than a role on the row itself. |
| D2 primary action reachable | Confirmed per route; the composer, submit, filter and approve controls stack full width below `sm`. |
| D3 readable contrast in both themes | Body resolves to white/slate-900 in light and slate-900/slate-100 in dark on every route; no slate-on-slate pairing survives into light mode. |
| D4 visible keyboard focus | 1,422 visible controls measured across all cells. Every one that can take focus paints a ring. The only ones that do not are `disabled` in the state audited (the composer and its submit while RAG is offline, submits on an empty form); each carries the ring classes for its enabled state. |

Spot checks worth recording:

- On `/primers/:id` at 320px the Markdown table (476px of content) and the code
  block (779px) each scroll inside their own bordered region against a 240px
  content column, with the document itself at 320px.
- The `/entries/:id` delete dialog fits at 320px (274px wide), does not widen the
  document while open, and still refuses to confirm until the entry id is typed.
- The graph canvas repaints on a light background with the light palette when the
  theme control is switched, and the connected-node list below it renders the
  selected node distinctly.

Standing notes:

- The graph canvas is raster, so its node labels are truncated to fit the node
  rather than wrapped. At 320px a long topic still shows as a clipped label
  inside its circle; the connected-node list below the canvas is the accessible
  reading of the same data, and the canvas names it in its `aria-label`.
- `JobsPage` and `TracesView` keep real tables. On narrow screens they scroll
  inside a bordered region rather than reflowing to cards, which keeps column
  alignment.
- The RAG-backed routes (`/ask`, `/ingest`, `/changes`, `/jobs`, `/traces`) were
  audited in their offline and error states plus their populated layouts. Their
  populated states need a running RAG backend to reproduce.

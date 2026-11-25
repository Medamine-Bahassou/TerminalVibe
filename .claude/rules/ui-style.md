---
paths:
  - "workspace.css"
  - "style.css"
  - "index.html"
  - "app.js"
---

# TerminalVibe UI style rule

This rule applies to any change that adds or alters something the user sees. The token table, component recipes and corner rules are in the **Design system** section of `CLAUDE.md`. Follow them exactly. This file explains the intent behind those rules so new work feels like the rest of the app, even where no recipe covers it.

## How the app should feel

- **The terminal is the hero.** Everything else is a quiet frame around it. Chrome (sidebar, tab bars, headers, popovers) should recede, not compete. If a new element draws the eye more than the terminal output does, it is too loud.
- **Calm, dense, precise.** Think Linear, Warp, Cursor: a dark surface, hairline structure, small and crisp type, and generous but tight 4px-grid spacing. Nothing feels "webby", bubbly or playful.
- **Hierarchy through tone, not decoration.** Separate layers with slight shifts of the background (`--bg` → `--ui-sidebar` → `--ui-surface` → `--ui-hover`) and 1px `--ui-line` hairlines. Don't use thick borders, gradients, heavy shadows or colored panels.
- **Color is a signal, not a decoration.** Almost everything is neutral (`--fg`, `--muted-text`, `--dim-text`). `--accent` marks focus, the one primary action and the active item, nothing more. `--ui-success` / `--ui-error` appear only for real state. If a screen has more than one or two accent touches, remove some.
- **Theme-proof by construction.** Users switch themes at runtime. Every color is a token or a `color-mix(in srgb, …)` of tokens, so a new surface looks right in every theme without extra work.
- **Responsive, never theatrical.** Feedback is instant and subtle: a background tint on hover, a ring on focus, a 120–180ms color transition. No bounces, scale-ups, slide-ins or attention-seeking motion. The terminal never animates.
- **Native-feeling.** Menus behave like OS menus (Electron uses native `Menu`). Keyboard focus is always visible. Click targets meet the size table. Text is sentence case.

## Decision checklist (run it before finishing a UI change)

1. **Reuse first.** Is there an existing component with this shape (popover, input, search field, list row, card, dialog, switch, checkbox, dropdown via `initCustomDropdown`)? Copy its markup and classes. Don't invent a variant.
2. **Colors**: no hex/rgb literals except the documented `#0d1017` primary-button text and `#0005`-style shadows. Everything else is a token or a `color-mix` of tokens.
3. **Type**: UI 13px/400, labels 500, headings 600. Secondary 12px, metadata 11–11.5px. No uppercase + letter-spacing labels. Paths, keys, ports and code use `--mono-font`. Never style `.xterm`.
4. **Sizes**: values sit on the 4px grid. Controls are 28–36px tall, menu rows 32px, sidebar rows ≥ 40px.
5. **Corners**: rounding is opt-in with `!important` (`body.roundless` resets everything to 0). Use the documented radii only. The collapsed sidebar stays square.
6. **State**: use an icon (`ph-check-circle`, `ph-warning-circle`, spinning `ph-circle-notch`) tinted with a status token. Never use colored dots, glow rings or labelled pills.
7. **Interaction**: hover = `--ui-hover` background. Focus = the documented ring (inputs: accent border + 3px soft ring; buttons: 2px gap + 4px accent ring). Never stack an outline on a border.
8. **Motion**: transitions only on `background-color, color, border-color, box-shadow`, 120–180ms, with a `prefers-reduced-motion: reduce` override next to them.
9. **Placement**: styles go in a commented, component-scoped block at the end of `workspace.css`. JS-built markup uses semantic class names, not Tailwind strings. Don't refactor `style.css`.
10. **Both modes**: desktop-only UI checks `window.electronAPI?.x` and has a browser-mode fallback that looks the same.
11. **Verify**: `node scripts/build-dist.js`, then look at it in the app at a narrow and a wide window, in at least one light-ish and one dark theme.

## Red flags (stop and rework)

- A new color, font size, radius or shadow value that exists nowhere else in `workspace.css`.
- `uppercase`, `letter-spacing` on labels, `font-weight: 700`, or emoji as icons.
- Accent-filled backgrounds on anything other than a primary button or the active indicator.
- Checkmarks or accent tint on the selected row of a menu/dropdown (use `--ui-hover`).
- Dashed dividers, double borders, inner shadows, gradients, or glassmorphism/blur on surfaces (panels, cards, menus, popovers). Exception: modal dialog backdrops use `background:rgba(0,0,0,0.5); backdrop-filter:blur(8px)`, as `#close-confirm-overlay::backdrop` does. Copy that.
- `transition: all`, `transform` animations on hover, or any animation on terminal paths.
- Inline `style="color:…"` or Tailwind color classes in JS-built markup.
- A modal, toast or banner where an inline hint, tooltip or existing panel would do.

When a design need isn't covered here or in `CLAUDE.md`, pick the quietest option that still communicates, match the nearest existing component, and say in the reply which precedent you followed.

## Lessons from corrections

Mistakes the user has corrected. Read these before a UI change, and add a line here whenever a new correction comes in.

- **Keep an audit trail in the history.** The user wants a record of what happened, not only the current state. When something starts or stops, gets shared or stopped (a server, a process, a merge, a side chat), add a `.thr-status-line` at that point in the history and save it in the chat state so it survives restarts. Put events that happen after the last prompt into `contextLines`. Live controls can sit elsewhere (a composer bubble), but the events still go in the history.
- **Order is everything in the history.** An event goes after the response of the turn it happened in, never above the prompt that caused it. Interleave by time with everything, including pending (not yet transcribed) messages (`pendingHtml(ws, '', ctx)`). Pin an event that happens during a turn after that turn's prompt timestamp. Before finishing, walk through the sequence send → event → reply and check where each line lands.
- **User preference: events wait for the end of the response.** While the agent is still answering, don't show an event line (server started, process stopped, …) at all, not even at the bottom between live steps and "Thinking". Hold it until the response ends, then show it directly below the response. Only live controls (the composer bubble) update immediately. Implemented in `refreshThreadFlow`: `working ? '' : ctx.before(Infinity)`.
- **No repeated chrome in the history.** The agent header (harness · model · time) shows only when the agent or model changes. That includes a just-sent message that the transcript doesn't have yet. Pass the render's `lastHead` into `pendingHtml`, never `''`.
- **Both sides of a cross-thread action show it.** When an action links two threads (a side chat shared as context), each thread's history shows its own status line: the side chat says "Shared as context with X · goes with its next message", and the parent says "Side chat Y goes with your next message · Discard", then "Included side chat Y". Building the HTML isn't enough; check that it's actually appended (`ctx.waiting` was built but never rendered).
- **Undone pending actions vanish; they don't leave a trail.** The audit is for things that happened. A discarded "Use as context" removes its status line instead of showing "discarded". (A real stop, like a server stopped, is still logged.)
- **Destructive actions turn red on hover.** Small inline ones (Discard, Delete, Stop) rest gray (`--muted-text`, `--border`) and only turn `--ui-error` on hover (text, border and a light red tint). Don't leave them red at rest, and don't keep them neutral on hover.
- **Audit lines are grouped, short and neutral.** Several events of one kind that happen together make one line ("Stopped 127.0.0.1:4096, python server.py by user"), never a stack of near-identical lines. Show short names (host:port, binary + script) with the full text in a tooltip, not long paths. Say "user", not "you".
- **Chat: live status that isn't part of the conversation stays out of the history.** Still-running processes were first a bordered card in the message flow, then plain text there. Both were rejected. Such status goes on the composer's top edge as a bubble next to the side-chats bubble (`.thr-sides-bubble`).
- **Chat: anything that expands from the composer's edge opens as the side-chats tray** (`.thr-sides:not(.collapsed)`: header label + caret, full-width `.thr-side-row`s, the row action where `.thr-side-del` sits). Don't use a floating popover there, even though it's the standard menu recipe.
- **"Like X" means X's exact placement.** "Like the Ctrl+J terminal" meant inside the same tab, sharing its tab bar, not a new split pane with its own header. When a request names a precedent, copy where it lives and how it attaches (`toggleChatBottomTerminal`), not just its general idea, and ask if the placement is unclear.
- **Tooltips are short.** A few words that name the action. Don't repeat what's already visible next to the control (like the thread's name in the same bar), and don't add user-provided text (titles, prompts) to an action's tooltip.
- **Tooltips are never truncated.** A tooltip exists to show the full text that's cut off elsewhere. `.ui-tooltip` wraps (max 360px); don't give tooltips `nowrap` or an ellipsis.
- **Every bar must hold up at panel width (~250px).** Chats now live in narrow side panels. A bar with a label + name + actions needs a narrow layout (a container query: labels collapse to icons with tooltips, and names keep the room). Check that nothing overlaps or shows through (no transparent strips under the composer).
- **Several chats can be on screen at once** (a thread plus its side chat panel, or splits). Per-chat layout values (like `--thr-composer-pad`) belong on each chat surface, never on `:root`, or one chat's composer sets another's spacing.
- **Check new controls against Settings' generic styles.** `#settings-modal input[type="text"]` (and similar) outranks a plain component class, so a search field with an icon inset lost its left padding and the text ran under the icon. Inside Settings, check the computed padding and size of any new input, and give the component's padding enough weight to win.
- **Hover zones are exactly where the thing is.** A hover-to-reveal control answers only over its own spot, not a full-width row and not another control (the composer's input). Set `pointer-events:none` on wide containers and give only the control (or its reveal area) `pointer-events:auto`.
- **Header icon buttons all hover the same way.** Muted icon, then a `--ui-hover` tile with `--fg` on hover (the threads sidebar's `.ts-icon-btn`), never an accent-colored icon. When an older control in `style.css` still uses an accent hover, override it in `workspace.css`.
- **One control per job.** Don't show two elements that do the same thing (e.g. the top "Side chat of …" bar and a composer bubble that links to the same thread). Keep the clearer one, and move any action that only the other one had into it ("Use as context" now sits in the top bar).
- **A tray folds once its job is done.** Picking a side chat from the side-chats tray opens it and collapses the tray back to its bubble. Don't leave the list open over the history.
- **Composer-edge trays start collapsed** (bubble only). Opening one is the user's choice and isn't forced open by default.
- **A copy of a component needs all of its classes' styles.** When reusing a look (e.g. `.thr-sides-bubble`), check which base class supplies the rest (`.thr-sides-toggle` gives centering and 13px icons). If you can't use that class, copy its rules, then compare the copy with the original side by side.
- **Row actions positioned over a row need reserved space.** An absolutely placed action (`.thr-side-del`, Stop) must not cover the row's content. Check that the padding that reserves its space really applies, since a more specific rule may override it. Test with the longest content (a URL on the right edge), not just a short title.
- **Fix layout bugs inside the existing mechanism.** When asked to fix a glitch (e.g. history text under the composer), keep the current approach (`--thr-composer-pad`) and fix its edge case. Don't redesign it.
- **Rendered content belongs to the message, not a code container.** Live UI from an agent's reply (A2UI surfaces) sits directly in the reply's text flow, like tables and images. Don't wrap it in the code-block frame with copy/code toggles, which gives it a double frame and makes it read as a code sample. No boxes either: an A2UI `Card` renders flat (no background, border or padding), so charts and forms read as part of the reply. It spans the reply's full width (no max-width cap), and inputs side by side share their row instead of keeping their natural width.
- **In a two-line row, the leading icon lines up with the title line**, not the middle of the card. Check both shapes: a one-line card stays centered, and only a card with a second line pins the icon to the top (`:has(.ws-procs:not(:empty))`).
- **A spinning icon needs a square box.** Give a rotating `ph-circle-notch` an explicit equal width/height with the glyph centered (`display:grid; place-items:center`), or it wobbles around an off-center origin.
- **Blocks in a reply need real air around them, and no empty chrome rows.** In `.thr-msg-text` the reply's prose is bare text nodes, so a block is often the first/last *element* child and the `:first-child`/`:last-child` margin resets silently zero its spacing; check the gap with text before and after it. A control that would sit alone in a row (a chart's table toggle) becomes a hover-revealed corner button, like a code block's copy.
- **An event never splits a response.** A background task that ends while the agent is still working (Claude queues its notification between tool steps) belongs to that turn: no second "Worked for" divider, and no status line in the response at all ("Background command failed · …" was rejected). The call's row in the steps shows how it ended (red `ph-warning-circle`), and the agent's reply explains it. Only a notification that arrives after the reply starts a turn of its own (`inTurn` in `threads.js`).
- **A copied look includes its hover.** A chip rendered as a `<span>` (sent `$skill` chip) lost the underline the composer's `<a>` version got from `.thr-inline-ref a:hover`. When the same element exists in two places, hover each one and compare, not just their resting look.
- **A card that floats over the chat must lift off it.** The skill popover first used the menu recipe (`--bg`, 12px padding, muted 13px text) and blended into the history; it was called "bad". An info card (hover-card style) uses `--ui-surface`, a 10px radius, 16px padding, a deeper shadow, a 14px/600 title, body text near `--fg` (not `--muted-text`) and a 32px secondary button. When the user sends a reference picture, render yours (headless Chrome over `dist/*.css`) and compare them side by side before saying it's done.
- **A card anchored to an inline chip is centered on it and fades.** The skill popover was left-aligned to the chip and popped in; the user wanted it centered over the chip (clamped to the window) with a 150ms opacity fade in and out (`.skill-pop.open`, removed after the fade, no clicks while fading). Opacity is the one allowed non-color transition here, and only for floating cards, never terminal paths.
- **A click-opened card toggles on its trigger.** Click the chip to open the card, click the same chip again to close it (also Escape, an outside click or a scroll). Clicking a different chip swaps the card. Don't make a second click reopen it.
- **Reading a file opens it beside the chat, not in a modal.** "View instructions" first opened a modal dialog; the user wanted the file in a right panel inside the chat's tab, like a side chat panel, shown as a read-only editor (line numbers, wrapped lines under their number, syntax colors). `openChatFilePanel` does this: same `--chat-panel-width` and sash as the side chat panel, the chat's `hljs` colors.
- **Underlines never run under icons.** On an inline-flex link, `text-decoration` on the link reaches every child, icon glyph included. Put the underline on the name's `<span>` (`a:hover > span:not(.thr-inline-image-icon)`), or make the icon `inline-block` on an inline link (`.thr-link > i`). Check a hovered state by forcing `:hover` (DevTools `CSS.forcePseudoState`), not by eye at rest.
- **Gutters fit their numbers.** The file/diff panel's line-number columns were a fixed 40px, so 5-digit lines (11431) ran into each other. Size number columns from the data (`--cfp-digits` × `1ch` + padding) and test with the largest realistic value, not a 2-digit sample.
- **Test a scrolling view scrolled.** The diff2html panel looked right in a short render but broke in use: its `position:absolute` line numbers resolved against the panel (outside the scroller) and stayed put while code scrolled. Before calling a scrolling panel done, render it with long content scrolled partway, and give vendored widgets that position children a `position:relative` box inside the scroller.

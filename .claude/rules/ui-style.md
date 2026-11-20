---
paths:
  - "workspace.css"
  - "style.css"
  - "index.html"
  - "app.js"
  - "examples/**"
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
6. **State**: use a Phosphor icon (`ph-check-circle`, `ph-warning-circle`, spinning `ph-circle-notch`) tinted with a status token. Never use colored dots, glow rings or labelled pills.
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

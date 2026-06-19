---
type: API Reference
title: Frontend State Model
description: Workspaces, layouts, groups, and terminal entries — the core state structures in app.js.
tags: [state, model, workspaces, layout]
timestamp: 2026-06-19T00:00:00Z
---

# Frontend State Model

All UI state is managed in vanilla JS within `app.js`. No framework — direct DOM mutation.

## Top-Level State

```js
workspaces: Workspace[]
activeWsId: string
focusedSlotId: string | null
_multiSelected: Set<termId>
_wsDomCache: Map<wsId, DOMContainer>
currentThemeName: string
currentFontSize: number
```

## Workspace

```js
{
  id: string,           // Unique workspace ID
  label: string,        // Display name
  color?: string,       // Sidebar color
  activeTermId: string, // Currently active terminal
  layout: LayoutNode,   // Root of split/group tree
  _maximizedGroupId?: string  // Group ID if maximized
}
```

## Layout Tree

Recursive structure of splits and groups:

### SplitNode

```js
{
  type: 'split',
  id: string,
  direction: 'h' | 'v',     // Horizontal or vertical
  sizes: number[],           // Percentage sizes [0-100]
  children: LayoutNode[]     // Nested splits or groups
}
```

### GroupNode

```js
{
  type: 'group',
  id: string,
  activeTermId: string,      // Active tab in this group
  _history: string[],        // Tab activation history
  terminals: TerminalEntry[] // Tabs (terminals + browser)
}
```

## TerminalEntry

```js
{
  id: string,
  label: string,
  type: 'terminal' | 'browser',

  // Terminal-specific:
  term: xterm.Terminal,      // xterm.js instance
  fit: FitAddon,             // Fit addon
  search: SearchAddon,       // Search addon
  el: HTMLElement,           // DOM element
  cwd?: string,              // Current working directory
  pending?: boolean,         // Waiting for shell ready
  color?: string,            // Tab color

  // Browser-specific:
  iframe?: HTMLIFrameElement,
  browserContainer?: HTMLElement,
  el: HTMLElement,
  url: string,               // Current URL
  opened?: boolean,          // Has been displayed
  _suspendTimer?: number     // Offscreen suspension timer
}
```

## Serialization

State is persisted to `localStorage['ghostterm-state-v2']`:

- Layout serialized as JSON (splits + groups + terminal metadata)
- Browser URLs persisted
- Terminal PTY state is **not** persisted (sessions are ephemeral)

## Related

- [Frontend Layer](../architecture/frontend.md) implementation details
- [Tauri IPC Commands](./tauri-ipc.md) terminal lifecycle

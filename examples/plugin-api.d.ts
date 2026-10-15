/**
 * TerminalVibe plugin API types (mirrors the `api` object passed to
 * activate()/onload()). Reference it from TypeScript plugin sources:
 *
 *   /// <reference path="../plugin-api.d.ts" />
 *
 * At runtime the `TerminalVibe` global always exists in the desktop app
 * (see app.js → ensureTerminalVibeGlobal), so TS sources can subclass
 * `TerminalVibe.Plugin` directly with no imports — esbuild leaves the
 * global reference untouched:
 *
 *   npx esbuild src/main.ts --format=cjs --platform=browser --outfile=main.js
 *
 * (`--bundle` is unnecessary unless you import npm packages; the file just
 * needs CommonJS output assigning to `module.exports`.)
 */
declare namespace TerminalVibe {
  interface KeyCombo {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    /** Single char (case-insensitive) or key/code string like 'F5'. */
    key: string;
  }

  /** Obsidian-style hotkey entry: { modifiers: ['Ctrl','Shift'], key: 'H' }. */
  interface ObsidianHotkey {
    modifiers?: string[];
    key: string;
  }

  interface CommandDef {
    /** Unique id — auto-prefixed with '<pluginId>:' when it has no prefix. */
    id: string;
    /** Human label. `name` is accepted as an Obsidian-style alias. */
    label?: string;
    name?: string;
    combo?: KeyCombo | null;
    /** Obsidian-style keybindings (first entry wins). */
    hotkeys?: ObsidianHotkey[] | ObsidianHotkey;
    handler?: () => void;
    /** Obsidian-style command body. */
    callback?: () => void;
    checkCallback?: (checking: boolean) => void;
  }

  interface MenuItem {
    label: string;
    icon?: string;
    when?: (data: any) => unknown;
    handler: (data: any) => void;
  }

  type MenuKind = 'terminal' | 'workspace' | 'folder';

  interface Theme {
    label: string;
    bg: string;
    fg: string;
    cursor: string;
    selection: string;
    swatches?: string[];
    palette?: string[];
    ui?: Record<string, string>;
  }

  interface WidgetDef {
    id?: string;
    /**
     * 'statusbar' → status-bar strip (shown once a plugin adds a widget).
     * 'sidebar' → bottom of the sidebar.
     * 'sidebar-top' → above the WORKSPACES header (e.g. a banner image).
     */
    position?: 'statusbar' | 'sidebar' | 'sidebar-top';
    el: HTMLElement;
  }

  interface ConfigChange {
    id: string;
    config: Record<string, any>;
    changed: string[] | null;
  }

  interface ActiveTerminal {
    id: string;
    label: string;
    type: 'terminal' | 'browser';
    url: string | null;
    wsId: string;
  }

  interface PluginApi {
    id: string;
    name: string;
    version: string;
    log(...args: any[]): void;
    events: {
      on(event: string, cb: (data: any) => void): void;
      off(event: string, cb: (data: any) => void): void;
    };
    commands: {
      register(def: CommandDef): void;
      unregister(id: string): void;
      run(id: string): void;
    };
    menus: {
      add(type: MenuKind, item: MenuItem): void;
      remove(type: MenuKind, label: string): void;
    };
    themes: {
      register(name: string, theme: Theme): void;
      unregister(name: string): void;
    };
    terminal: {
      /**
       * Write to a terminal's screen buffer (display-only, never the shell).
       * Returns false when the terminal is missing.
       */
      write(id: string, data: string | Uint8Array): boolean;
    };
    ui: {
      addWidget(w: WidgetDef): void;
      removeWidget(id: string): void;
    };
    config: {
      get(key: string, fallback?: any): any;
      set(key: string, value: any): void;
      all(): Record<string, any>;
      onChange(cb: (change: ConfigChange) => void): void;
    };
    state: {
      getActiveTerminal(): ActiveTerminal | null;
      getActiveWorkspace(): { id: string; label: string } | null;
      getWorkspaces(): Array<{ id: string; label: string }>;
    };
  }

  /**
   * Obsidian-style base class. Subclass it and export the class (default or
   * module.exports) from main.js:
   *
   *   export default class MyPlugin extends TerminalVibe.Plugin {
   *     async onload() { this.addCommand({ id: 'hi', name: 'Say hi', callback: () => {...} }); }
   *     onunload() {}
   *   }
   */
  class Plugin {
    api: PluginApi;
    /** Alias of api (Obsidian plugins use `this.app`). */
    app: PluginApi;
    manifest: { id: string; name: string; version: string };
    pluginId: string;
    constructor(api: PluginApi);
    readonly name: string;
    log(...args: any[]): void;
    onload(): void | Promise<void>;
    onunload(): void;
    /** Returns the full (possibly prefixed) command id. */
    addCommand(def: CommandDef): string | null;
    /** Status-bar element the plugin can fill (mounted automatically). */
    addStatusBarItem(): HTMLElement;
    /** Sidebar button (Obsidian's left ribbon). */
    addRibbonIcon(icon: string, title: string, cb?: (ev: MouseEvent) => void): HTMLElement;
    registerEvent(event: string, cb: (data: any) => void): { ev: string; cb: (data: any) => void };
    off(event: string, cb: (data: any) => void): void;
    /** Persisted config blob (backed by api.config). */
    loadData(): Promise<Record<string, any>>;
    saveData(obj: Record<string, any>): Promise<void>;
  }

  function register(def: {
    id: string;
    activate(api: PluginApi): void | Promise<void>;
    deactivate?(): void;
  }): void;
}

declare const TerminalVibe: {
  register: typeof TerminalVibe.register;
  Plugin: typeof TerminalVibe.Plugin;
};

// Child programs must detect this terminal, not the terminal that launched us.
// In particular, inherited Konsole/Kitty markers make Yazi select a graphics
// protocol our xterm 5 image addon does not implement.
function terminalEnv(base = process.env) {
  const env = { ...base };
  for (const key of [
    'KITTY_WINDOW_ID', 'KITTY_PID', 'KONSOLE_VERSION', 'KONSOLE_DBUS_SESSION',
    'KONSOLE_DBUS_WINDOW', 'KONSOLE_DBUS_SERVICE', 'ITERM_SESSION_ID',
    'ITERM_PROFILE', 'WEZTERM_EXECUTABLE', 'WEZTERM_PANE', 'WEZTERM_UNIX_SOCKET',
    'GHOSTTY_RESOURCES_DIR', 'WT_Session', 'WT_SESSION', 'WARP_HONOR_PS1',
    'VSCODE_INJECTION', 'TABBY_CONFIG_DIRECTORY',
  ]) delete env[key];
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor',
    TERM_PROGRAM: 'TerminalVibe', TERM_PROGRAM_VERSION: require('../package.json').version };
}

module.exports = { terminalEnv };

const fs = require('fs');
const os = require('os');
const path = require('path');

const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Windows has no /proc, so PowerShell reports its cwd after each prompt. Inline because
// execution policy can block script files; profiles still load, and the wrapped prompt runs first so themes see $?.
const POWERSHELL_CWD_HOOK = "$__tvPrompt=$function:prompt;function global:prompt{$p=& $__tvPrompt;"
  + "[Console]::Write([char]27+']7;file:///'+[uri]::EscapeDataString((Get-Location -PSProvider FileSystem).ProviderPath)+[char]7+[char]27+']133;A'+[char]7);$p}";

// WSL shells report a Windows path, so a new tab in any shell can start there: wsl.exe maps it back to Linux.
const WSL_CWD_REPORT = [
  '  local dir',
  '  dir="$(wslpath -w "$PWD" 2>/dev/null)" && printf "\\e]7;file:///%s\\a" "${dir//\\%/%25}"',
];
// A plain WSL tab is a login shell, so this one reads the same files. Bash ignores --rcfile in a login shell.
const WSL_BASH_LOGIN = [
  '[ ! -r /etc/profile ] || source /etc/profile',
  'if [ -r ~/.bash_profile ]; then source ~/.bash_profile; elif [ -r ~/.bash_login ]; then source ~/.bash_login; elif [ -r ~/.profile ]; then source ~/.profile; fi',
];
// If the hook files can't be read from Linux, or the shell has no hook, it still opens without one.
const WSL_START = 'shell=$(getent passwd "$(id -un)" | cut -d: -f7); [ -r "$TV_WSL_DIR/bashrc" ] && case "$shell" in '
  + '*/zsh) export ZDOTDIR="$TV_WSL_DIR"; exec "$shell" -l;; */bash) exec "$shell" --rcfile "$TV_WSL_DIR/bashrc";; esac; exec "${shell:-/bin/sh}" -l';

function writeBashRc(dir, startup, cwdReport) {
  const rc = path.join(dir, 'bashrc');
  fs.writeFileSync(rc, [
    ...startup,
    '__terminal_vibe_cwd() {',
    ...cwdReport,
    '  printf "\\e]133;A\\a"',
    '}',
    // Preserve both scalar and array PROMPT_COMMAND configurations.
    'if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a "* ]]; then',
    '  PROMPT_COMMAND=(__terminal_vibe_cwd "${PROMPT_COMMAND[@]}")',
    'else',
    '  PROMPT_COMMAND="__terminal_vibe_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
    'fi', '',
  ].join('\n'), { mode: 0o600 });
  return rc;
}

// Zsh uses ZDOTDIR for both startup files and completion caches. Restore
// the user's directory before sourcing their files, or Oh My Zsh rebuilds
// a fresh completion dump for every tab. Forward .zshenv too, including any
// ZDOTDIR changes it makes, and .zprofile for login shells, then route only
// .zshrc through our wrapper.
function writeZshFiles(dir, env, rcDir, cwdReport) {
  fs.writeFileSync(path.join(dir, '.zshenv'), [
    env.ZDOTDIR === undefined ? 'unset ZDOTDIR' : `export ZDOTDIR=${quote(env.ZDOTDIR)}`,
    '[[ ! -r ${ZDOTDIR:-$HOME}/.zshenv ]] || source "${ZDOTDIR:-$HOME}/.zshenv"',
    'typeset -g __terminal_vibe_zdotdir_set=${+ZDOTDIR}',
    'typeset -g __terminal_vibe_zdotdir=${ZDOTDIR-}',
    // Ubuntu's /etc/zsh/zshrc runs compinit while ZDOTDIR is still ours. Without this it finds no
    // completion dump and rebuilds one for every tab, which takes seconds on /mnt/c.
    // shortcut: only the first compinit is redirected, so one in .zshenv or .zprofile leaves Ubuntu's slow. Keep the stub after its first call if that shows up.
    'compinit() { unfunction compinit; autoload -Uz compinit; local ZDOTDIR=$__terminal_vibe_zdotdir; compinit "$@" }',
    `export ZDOTDIR=${rcDir}`, '',
  ].join('\n'), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zprofile'),
    '[[ ! -r ${__terminal_vibe_zdotdir:-$HOME}/.zprofile ]] || source "${__terminal_vibe_zdotdir:-$HOME}/.zprofile"\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zshrc'), [
    'if (( __terminal_vibe_zdotdir_set )); then',
    '  export ZDOTDIR=$__terminal_vibe_zdotdir',
    'else',
    '  unset ZDOTDIR',
    'fi',
    '[[ $functions[compinit] != *__terminal_vibe_zdotdir* ]] || { unfunction compinit; autoload -Uz compinit }',
    'unset __terminal_vibe_zdotdir_set __terminal_vibe_zdotdir',
    '[[ ! -r ${ZDOTDIR:-$HOME}/.zshrc ]] || source "${ZDOTDIR:-$HOME}/.zshrc"',
    '__terminal_vibe_cwd() {',
    ...cwdReport,
    '  printf "\\e]133;A\\a"',
    '}',
    'precmd_functions+=(__terminal_vibe_cwd)', '',
  ].join('\n'), { mode: 0o600 });
}

// Temporary integration files only; never modify the user's shell config.
function prepareShellStartup(shell, env = process.env) {
  const name = path.basename(shell).toLowerCase().replace(/\.exe$/, '');
  if (name === 'powershell' || name === 'pwsh') {
    return { args: ['-NoExit', '-Command', POWERSHELL_CWD_HOOK], env: {}, tmpDir: null };
  }
  if (name === 'cmd') {
    // shortcut: $P isn't URI-encoded, so a folder name containing % stops updating the cwd. Encoding needs a real hook.
    return { args: [], env: { PROMPT: `$e]7;file:///$P$e\\$e]133;A$e\\${env.PROMPT || '$P$G'}` }, tmpDir: null };
  }
  if (name !== 'bash' && name !== 'zsh' && name !== 'wsl') return { args: [], env: {}, tmpDir: null };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tv-${name}-`));
  try {
    if (name === 'wsl') {
      writeBashRc(tmpDir, WSL_BASH_LOGIN, WSL_CWD_REPORT);
      writeZshFiles(tmpDir, {}, '"$TV_WSL_DIR"', WSL_CWD_REPORT);
      const WSLENV = [env.WSLENV, 'TV_WSL_DIR/p'].filter(Boolean).join(':');
      return { args: ['-e', 'sh', '-c', WSL_START], env: { TV_WSL_DIR: tmpDir, WSLENV }, tmpDir };
    }
    if (name === 'bash') {
      const gitBash = process.platform === 'win32';
      const rc = writeBashRc(tmpDir, [
        // Git Bash gets its PATH and prompt from the login profile.
        ...(gitBash ? ['source /etc/profile'] : []),
        '# Interactive tabs load bashrc once; login profiles may source it again.',
        '[ ! -r ~/.bashrc ] || source ~/.bashrc',
      ], [
        // Paths like /tmp only exist inside Git Bash, so it reports the Windows path.
        `  local dir="${gitBash ? '/$(pwd -W)' : '$PWD'}"`,
        '  printf "\\e]7;file://%s%s\\a" "${HOSTNAME:-localhost}" "${dir// /%20}"',
      ]);
      return { args: ['--rcfile', rc], env: {}, tmpDir };
    }

    writeZshFiles(tmpDir, env, quote(tmpDir), ['  printf "\\e]7;file://${HOST:-localhost}${PWD}\\a"']);
    // Match desktop tabs: an interactive shell, without login profile work.
    return { args: [], env: { ZDOTDIR: tmpDir }, tmpDir };
  } catch (error) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { prepareShellStartup };

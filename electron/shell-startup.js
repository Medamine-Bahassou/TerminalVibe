const fs = require('fs');
const os = require('os');
const path = require('path');

const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Windows has no /proc, so PowerShell reports its cwd after each prompt. Inline because
// execution policy can block script files; profiles still load, and the wrapped prompt runs first so themes see $?.
const POWERSHELL_CWD_HOOK = "$__tvPrompt=$function:prompt;function global:prompt{$p=& $__tvPrompt;"
  + "[Console]::Write([char]27+']7;file:///'+[uri]::EscapeDataString((Get-Location -PSProvider FileSystem).ProviderPath)+[char]7+[char]27+']133;A'+[char]7);$p}";

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
  if (name !== 'bash' && name !== 'zsh') return { args: [], env: {}, tmpDir: null };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tv-${name}-`));
  try {
    if (name === 'bash') {
      const rc = path.join(tmpDir, 'bashrc');
      const gitBash = process.platform === 'win32';
      fs.writeFileSync(rc, [
        // Git Bash gets its PATH and prompt from the login profile.
        ...(gitBash ? ['source /etc/profile'] : []),
        '# Interactive tabs load bashrc once; login profiles may source it again.',
        '[ ! -r ~/.bashrc ] || source ~/.bashrc',
        '__terminal_vibe_cwd() {',
        // Paths like /tmp only exist inside Git Bash, so it reports the Windows path.
        `  local dir="${gitBash ? '/$(pwd -W)' : '$PWD'}"`,
        '  printf "\\e]7;file://%s%s\\a" "${HOSTNAME:-localhost}" "${dir// /%20}"',
        '  printf "\\e]133;A\\a"',
        '}',
        // Preserve both scalar and array PROMPT_COMMAND configurations.
        'if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a "* ]]; then',
        '  PROMPT_COMMAND=(__terminal_vibe_cwd "${PROMPT_COMMAND[@]}")',
        'else',
        '  PROMPT_COMMAND="__terminal_vibe_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
        'fi', '',
      ].join('\n'), { mode: 0o600 });
      return { args: ['--rcfile', rc], env: {}, tmpDir };
    }

    // Zsh uses ZDOTDIR for both startup files and completion caches. Restore
    // the user's directory before sourcing their files, or Oh My Zsh rebuilds
    // a fresh completion dump for every tab. Forward .zshenv too, including any
    // ZDOTDIR changes it makes, then route only .zshrc through our wrapper.
    fs.writeFileSync(path.join(tmpDir, '.zshenv'), [
      env.ZDOTDIR === undefined ? 'unset ZDOTDIR' : `export ZDOTDIR=${quote(env.ZDOTDIR)}`,
      '[[ ! -r ${ZDOTDIR:-$HOME}/.zshenv ]] || source "${ZDOTDIR:-$HOME}/.zshenv"',
      'typeset -g __terminal_vibe_zdotdir_set=${+ZDOTDIR}',
      'typeset -g __terminal_vibe_zdotdir=${ZDOTDIR-}',
      `export ZDOTDIR=${quote(tmpDir)}`, '',
    ].join('\n'), { mode: 0o600 });
    fs.writeFileSync(path.join(tmpDir, '.zshrc'), [
      'if (( __terminal_vibe_zdotdir_set )); then',
      '  export ZDOTDIR=$__terminal_vibe_zdotdir',
      'else',
      '  unset ZDOTDIR',
      'fi',
      'unset __terminal_vibe_zdotdir_set __terminal_vibe_zdotdir',
      '[[ ! -r ${ZDOTDIR:-$HOME}/.zshrc ]] || source "${ZDOTDIR:-$HOME}/.zshrc"',
      '__terminal_vibe_cwd() {',
      '  printf "\\e]7;file://${HOST:-localhost}${PWD}\\a"',
      '  printf "\\e]133;A\\a"',
      '}',
      'precmd_functions+=(__terminal_vibe_cwd)', '',
    ].join('\n'), { mode: 0o600 });
    // Match desktop tabs: an interactive shell, without login profile work.
    return { args: [], env: { ZDOTDIR: tmpDir }, tmpDir };
  } catch (error) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { prepareShellStartup };

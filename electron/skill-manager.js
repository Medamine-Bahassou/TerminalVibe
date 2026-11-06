const fs = require('fs');
const path = require('path');
const os = require('os');

const NAME = 'terminalvibe-orchestration';

// Move the whole skill outside discovery when disabled; a renamed folder under
// skills/ would still be discovered by agents scanning for SKILL.md.
function createSkillManager({ home = os.homedir(), source = path.join(__dirname, '..', 'skills', NAME), env = process.env } = {}) {
  const providers = [
    { id: 'claude', name: 'Claude Code', root: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills') },
    { id: 'codex', name: 'Codex', root: path.join(home, '.agents', 'skills') },
  ];
  function locations(id) {
    const provider = providers.find(p => p.id === id);
    if (!provider) throw new Error('Unknown skill provider');
    return { ...provider, active: path.join(provider.root, NAME), inactive: path.join(home, '.terminalvibe', 'disabled-skills', id, NAME) };
  }
  function exists(file) {
    try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function list() {
    return providers.map(provider => {
      const p = locations(provider.id);
      const active = exists(p.active);
      const inactive = exists(p.inactive);
      return { id: p.id, name: p.name, path: p.active, installed: active || inactive, enabled: active,
        conflict: active && inactive };
    });
  }
  function setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    const p = locations(id);
    const from = enabled ? p.inactive : p.active;
    const to = enabled ? p.active : p.inactive;
    if (exists(from) && exists(to)) throw new Error('Both active and inactive copies exist. Resolve these copies before toggling.');
    if (exists(to)) return list();
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (exists(from)) {
      // Rename also preserves manually installed skills and symlinks verbatim.
      fs.renameSync(from, to);
    } else if (enabled) {
      // Stage a complete copy so discovery never sees a partial installation.
      const staging = fs.mkdtempSync(path.join(path.dirname(p.root), '.terminalvibe-install-'));
      try {
        fs.cpSync(source, path.join(staging, NAME), { recursive: true, dereference: true });
        fs.renameSync(path.join(staging, NAME), to);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }
    return list();
  }
  return { list, setEnabled };
}

module.exports = { createSkillManager };

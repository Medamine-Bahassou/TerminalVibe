// Isolated DOM tests: no real terminals, commands, or user configuration.
const fs = require('node:fs');
const path = require('node:path');
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, '--no-sandbox'], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const section = source.slice(source.indexOf('  // Project threads use'), source.indexOf('  /* ── Folder helpers'));
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  console.log(await win.webContents.executeJavaScript(`(() => {
    const check = (value, message) => { if (!value) throw Error(message); };
    document.body.innerHTML = '<div id="sidebar-inner"><div class="sidebar-actions"></div></div>';
    let projects = [], projectsCollapsed = false, workspaces = [], activeWsId, serial = 0, saved, answer = '';
    const defaultTerminalPath = '';
    const uuid = () => String(++serial);
    const saveState = () => { saved = JSON.parse(JSON.stringify({projects, projectsCollapsed, workspaces})); };
    const showPrompt = (title, initial, options, callback) => callback(answer);
    const showConfirm = (message, callback) => callback();
    const renderSidebar = () => renderProjects();
    const renderProjectThreadView = () => {};
    const activeWs = () => workspaces.find(w => w.id === activeWsId);
    const activateWorkspace = id => { activeWsId = id; renderProjects(); };
    const createWorkspace = (label, folder, opts) => {
      const w = {id:uuid(), label, projectId:opts.projectId, cwd:opts.cwd};
      workspaces.push(w); activateWorkspace(w.id); saveState(); return w;
    };
    let launches = [];
    const addTerminal = (id, group, opts) => launches.push({id, ...opts});
    const removeWorkspace = id => { workspaces = workspaces.filter(w => w.id !== id); renderProjects(); saveState(); };
    const zoomBadge = message => { throw Error(message); };
    ${section}
    const click = label => {
      const el = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
      check(el, 'Missing action: ' + label); el.click();
    };
    renderProjects();
    check(document.querySelector('.project-empty'), 'Missing empty state');
    const p = addProject('/tmp/project with spaces');
    check(addProject('/tmp/project with spaces/') === p && projects.length === 1, 'Duplicate project');
    answer = '<img src=x> Thread'; newProjectThread(p);
    const w = workspaces[0];
    check(w.cwd === p.cwd && w.projectId === p.id, 'Wrong thread directory or owner');
    check(!document.querySelector('img'), 'Thread title treated as HTML');
    answer = 'Second'; newProjectThread(p);
    check(workspaces.length === 2, 'Multiple threads not supported');
    click(w.label);
    check(activeWsId === w.id && document.querySelector('[aria-current="true"]').textContent === w.label, 'Thread activation');
    click('Thread actions for ' + w.label);
    check(!document.querySelector('.project-thread-controls').hidden, 'Actions not accessible');
    answer = 'codex resume exact-session'; click('Save resume command');
    check(saved.workspaces[0].resumeCommand === answer && launches.length === 0, 'Saving command executed it or failed to persist');
    click('Run resume command');
    check(launches.length === 1 && launches[0].cwd === p.cwd && launches[0].cmd === answer, 'Explicit resume launch incorrect');
    answer = 'Renamed'; click('Rename');
    check(w.label === answer, 'Rename failed');
    click(p.cwd);
    check(!document.querySelector('.project-thread') && saved.projects[0].collapsed, 'Project collapse not saved');
    click('Projects'); check(saved.projectsCollapsed, 'Section collapse not saved');
    // Simulate a state round trip, then verify reconstruction does not launch a CLI.
    ({projects, projectsCollapsed, workspaces} = JSON.parse(JSON.stringify(saved)));
    renderProjects(); check(launches.length === 1, 'Restore auto-ran command');
    click('Projects'); click(p.cwd);
    click('Remove project');
    check(projects.length === 0 && workspaces.length === 2 && workspaces.every(w => !w.projectId), 'Removal lost threads');
    check(document.querySelector('.projects-section').nextElementSibling.className === 'sidebar-actions', 'Projects are not above settings');
    return 'PASS: projects, multiple threads, folder inheritance, safe titles, activation, saved commands, explicit resume, rename, collapse, restore and non-destructive project removal';
  })()`));
  clearTimeout(timer); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });

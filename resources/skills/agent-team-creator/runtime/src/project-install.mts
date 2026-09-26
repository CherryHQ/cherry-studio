import fs from 'node:fs';
import path from 'node:path';
import { exportTeam } from './adapters.mjs';
import { validateTeam, id, object, target, text } from './validation.mjs';
import { bindUiRoles } from './ui-bindings.mjs';
import { commitChanges, hash, projectFile, readFile, stage, type Change } from './project-files.mjs';
import { instructionChanges } from './project-instructions.mjs';
import type { ObjectValue, Target, Team } from './types.mjs';

interface Routing { schemaVersion: 1; activeTeam: string; manifest: string; target: Target; nativeDefinitions: string[]; instructionFiles: string[]; delegation: 'native-definitions' | 'sequential-only'; limitations: string[] }

function discover(root: string): Map<string, Team> {
  const teams = new Map<string, Team>();
  const directory = projectFile(root, '.agent-team');
  if (!fs.existsSync(directory)) return teams;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'recovery') continue;
    const file = projectFile(root, `.agent-team/${entry.name}/team.json`);
    const content = readFile(file);
    if (content === null) continue;
    const team = validateTeam(JSON.parse(content));
    if (entry.name !== team.id) throw Error(`Team directory and manifest disagree: ${entry.name}`);
    teams.set(team.id, team);
  }
  return teams;
}

function nativeDestination(file: string, selected: Target, minimaxDirectory?: string): string | null {
  const prefixes: Partial<Record<Target, string>> = { codex: '.codex/agents/', claude: '.claude/agents/', copilot: '.github/agents/', kimi: '.kimi-code/agents/', opencode: '.opencode/agents/', deepseek: '.dsh/profiles/' };
  if (selected === 'minimax' && file.startsWith('agents/') && minimaxDirectory) return `${minimaxDirectory}/${file}`;
  const prefix = prefixes[selected];
  if (prefix && file.startsWith(prefix)) return file;
  const configs: Partial<Record<Target, string>> = { codex: '.codex/config.toml', claude: '.claude/settings.json', opencode: 'opencode.json' };
  return file === configs[selected] ? file : null;
}

/** The only creator operation that applies files to an authorized project. */
export function installProject(input: ObjectValue): unknown {
  const requested = text(input.project, 'project');
  if (path.sep !== '\\' && /^(?:[a-z]:[\\/]|\\\\)/i.test(requested)) throw Error('Windows absolute project paths require a Windows Node runtime');
  const root = fs.realpathSync(path.resolve(requested));
  if (!fs.statSync(root).isDirectory()) throw Error('project must be a directory');
  const changes = new Map<string, Change>();
  const recordPath = '.agent-team/project-routing.json';
  const recordText = readFile(projectFile(root, recordPath));
  const record = recordText === null ? undefined : object(JSON.parse(recordText), 'project routing');
  if (record && record.schemaVersion !== 1) throw Error('Unsupported project routing schema');
  const teams = discover(root);
  const supplied = input.team === undefined ? undefined : validateTeam(input.team);
  if (supplied) {
    if (supplied.scope !== 'project') throw Error('install-project requires a project-scoped team');
    const existing = teams.get(supplied.id);
    if (existing && JSON.stringify(bindUiRoles(existing)) !== JSON.stringify(bindUiRoles(supplied)) && input.updateTeam !== true) throw Error('Existing team differs; use updateTeam: true only for an intentional manifest update');
    teams.set(supplied.id, supplied);
  }
  const explicit = input.teamId === undefined ? undefined : id(input.teamId, 'teamId');
  const selectedId = explicit ?? (record ? id(record.activeTeam, 'activeTeam') : undefined) ?? (teams.size === 1 ? [...teams.keys()][0] : undefined);
  if (!selectedId) throw Error(teams.size ? `Multiple teams are available; select teamId: ${[...teams.keys()].join(', ')}` : 'No project team found; supply team or create .agent-team/<id>/team.json');
  const selectedTeam = teams.get(selectedId);
  if (!selectedTeam) throw Error(`Selected team does not exist: ${selectedId}. Choose an existing team explicitly.`);
  const team = bindUiRoles(selectedTeam);
  const selectedTarget = target(input.target ?? record?.target ?? team.harness);
  const diagnostics: string[] = [];
  const result = exportTeam(team, selectedTarget);
  diagnostics.push(...result.diagnostics);
  const minimaxDirectory = input.minimaxDataDirectory === undefined ? undefined : text(input.minimaxDataDirectory, 'minimaxDataDirectory');
  if (minimaxDirectory) projectFile(root, minimaxDirectory);
  if (selectedTarget === 'minimax') diagnostics.push(minimaxDirectory
    ? `MiniMax definitions require launching with MINIMAX_DATA_DIR set to the absolute project directory ${minimaxDirectory}; installing files does not set that environment.`
    : 'MiniMax data directory was not explicitly set inside this project; no global files were modified. Follow roles sequentially until native definitions are installed and discovered.');
  const definitions: string[] = [];
  for (const [file, content] of Object.entries(result.files)) {
    const destination = nativeDestination(file, selectedTarget, minimaxDirectory);
    if (!destination) continue;
    const absolute = projectFile(root, destination);
    const existing = readFile(absolute);
    if (existing === null) stage(changes, root, destination, content);
    else if (existing !== content) diagnostics.push(`Preserved existing native file ${destination}; project role bindings apply through the shared instructions. Native prompt/configuration edits require a deliberate merge.`);
    if (!['.codex/config.toml', '.claude/settings.json', 'opencode.json'].includes(destination)) definitions.push(destination);
  }
  const manifest = `.agent-team/${team.id}/team.json`;
  // Keep unrelated formatting and bytes when the manifest requires no role-binding change.
  const oldManifest = readFile(projectFile(root, manifest));
  const manifestContent = oldManifest !== null && JSON.stringify(validateTeam(JSON.parse(oldManifest))) === JSON.stringify(team)
    ? oldManifest : JSON.stringify(team, null, 2) + '\n';
  stage(changes, root, manifest, manifestContent);
  const instructionFiles = instructionChanges(root, changes, input.zed !== false);
  const routing: Routing = { schemaVersion: 1, activeTeam: team.id, manifest, target: selectedTarget,
    nativeDefinitions: definitions, instructionFiles, delegation: definitions.length ? 'native-definitions' : 'sequential-only',
    limitations: ['Native definition presence is not live invocation evidence. The active harness owns permissions, models, concurrency and delegation.',
      'When delegation is unavailable, use selected role instructions sequentially and report it; builder-context review is not independent.',
      'Zed external ACP agents use their native configuration; Zed parallel threads are not an automatic delegation API.'] };
  stage(changes, root, recordPath, JSON.stringify(routing, null, 2) + '\n');
  const planned = [...changes.values()];
  const report = { project: root, activeTeam: team.id, manifest, nativeDefinitions: definitions,
    changed: planned.map(c => c.file), clean: planned.length === 0, dryRun: input.dryRun === true, check: input.check === true,
    fingerprints: planned.map(c => ({ file: c.file, before: c.before === null ? null : hash(c.before), after: hash(c.after) })), diagnostics };
  if (input.dryRun === true || input.check === true) return { ...report, recovery: null };
  return { ...report, recovery: commitChanges(root, planned) };
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const boss = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.resolve(process.argv[2] ?? 'resources/prometheus-skills-mini');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-native-preload-'));
const cli = path.join(source, 'skills/agent-team-creator/scripts/cli.mjs');
const deferred = ['prometheus-ui-ux', 'prometheus-ui-review', 'interface-review', 'break', 'variant', 'explain-interface'];
const role = (id, skills) => ({ id, description: id, prompt: 'Use only the relevant role instructions.', skills, owns: [id + '/**'], inputs: [], outputs: ['evidence'], dependsOn: [] });
const team = { schemaVersion: 1, id: 'mixed-team', scope: 'project', harness: 'claude', outcome: 'UI and backend changes',
  roles: [role('ui-designer', ['prometheus-ui-ux']), role('reviewer', ['code-review-and-quality', ...deferred.filter(s => s !== 'prometheus-ui-ux')])] };
let counter = 0;
function invoke(command, input) {
  const file = path.join(temporary, `request-${counter++}.json`);
  fs.writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, [cli, command, '--input', file], { encoding: 'utf8', cwd: temporary });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function frontmatter(file) { return JSON.parse(fs.readFileSync(file, 'utf8').split('---')[1]); }
const results = [];
try {
  const proposal = path.join(temporary, 'proposal');
  invoke('export', { team, target: 'claude', out: proposal });
  for (const id of ['ui-designer', 'reviewer']) {
    const content = fs.readFileSync(path.join(proposal, '.claude/agents', id + '.md'), 'utf8');
    const native = frontmatter(path.join(proposal, '.claude/agents', id + '.md'));
    assert(!native.skills.some(s => deferred.includes(s)));
    assert(content.includes('Backend work does not activate UI guidance.'));
  }
  const project = path.join(temporary, 'project');
  fs.mkdirSync(project);
  invoke('install-project', { project, team });
  for (const id of ['ui-designer', 'reviewer']) assert(!frontmatter(path.join(project, '.claude/agents', id + '.md')).skills.some(s => deferred.includes(s)));
  const installed = JSON.parse(fs.readFileSync(path.join(project, '.agent-team/mixed-team/team.json'), 'utf8'));
  assert(installed.roles[0].skills.includes('prometheus-ui-ux'));
  assert(installed.roles[1].skills.includes('prometheus-ui-review'));
  assert(installed.roles[1].skills.includes('interface-review'));
  results.push({ status: 'passed', name: 'real export and installed Claude definitions defer conditional and user-only skills while retaining manifest bindings' });
  const overridden = structuredClone(team);
  overridden.roles[1].native = { claude: { skills: ['interface-review'], model: 'operator-model', permissionMode: 'plan' } };
  const overrideOutput = path.join(temporary, 'override-proposal');
  const result = invoke('export', { team: overridden, target: 'claude', out: overrideOutput });
  assert.deepEqual(frontmatter(path.join(overrideOutput, '.claude/agents/reviewer.md')).skills, ['interface-review']);
  assert.equal(frontmatter(path.join(overrideOutput, '.claude/agents/reviewer.md')).model, 'operator-model');
  assert.equal(frontmatter(path.join(overrideOutput, '.claude/agents/reviewer.md')).permissionMode, 'plan');
  assert(result.diagnostics.some(d => d.includes('conflicts with conditional UI loading or upstream user-only invocation restrictions')));
  results.push({ status: 'passed', name: 'explicit native override retained with incompatible-preload diagnostic before invocation' });
} catch (error) { results.push({ status: 'failed', message: error.message }); process.exitCode = 1; }
const evidence = { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  status: process.exitCode ? 'failed' : 'passed', results, limitations: ['Serialized and installed native artifacts were inspected; no Claude agent was invoked.'] };
fs.writeFileSync(path.join(boss, '.agent-team/boss-core/ui-routing-native-preload-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

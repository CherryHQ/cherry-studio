import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const boss = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.resolve(process.argv[2] ?? 'resources/prometheus-skills-mini');
const require = createRequire(import.meta.url);
const { copyPrometheusPayload } = require(path.join(boss, 'scripts/package-prometheus.js'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-ui-payload-'));
const payload = path.join(temporary, 'isolated payload ü');
const project = path.join(temporary, 'project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { react: '19.2.0', electron: '44.2.0' } }));
fs.writeFileSync(path.join(project, 'DESIGN.md'), '# Incumbent authority\nPreserve tokens and identity.\n');
const env = { HOME: temporary, USERPROFILE: temporary, PATH: '', LANG: 'en_US.UTF-8' };
const results = [];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(script, args, cwd = project) {
  const child = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(child.status, 0, `${script}: ${child.stderr}`);
  return JSON.parse(child.stdout);
}
function caseResult(name, fn) {
  try { const details = fn(); results.push({ name, status: 'passed', ...details }); }
  catch (error) { results.push({ name, status: 'failed', message: error.message }); process.exitCode = 1; }
}
try {
  caseResult('production offline payload materialization', () => {
    const receipt = copyPrometheusPayload(source, payload);
    assert(receipt.files.some(f => f.path === 'skills/prometheus-ui-ux/scripts/cli.mjs'));
    return { files: receipt.files.length };
  });
  const catalog = JSON.parse(fs.readFileSync(path.join(payload, 'skills/prometheus-ui-ux/references/catalog.lock.json'), 'utf8'));
  const selected = catalog.skills.filter(s => !s.mini.status.startsWith('excluded'));
  caseResult('portable UI catalog and runtime asset closure', () => {
    let files = 0;
    function visit(folder) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        assert(!entry.isSymbolicLink(), `linked runtime asset: ${file}`);
        assert(!/\.(?:sh|py|exe|dll|dylib|so|node|wasm)$/i.test(entry.name), `forbidden UI runtime asset: ${file}`);
        assert(!['node_modules', 'bin'].includes(entry.name), `native/dependency runtime directory: ${file}`);
        if (entry.isDirectory()) visit(file); else files++;
      }
    }
    for (const skill of selected) {
      const folder = path.join(payload, skill.mini.path);
      assert(fs.existsSync(path.join(folder, 'SKILL.md')), skill.id);
      visit(folder);
    }
    const proMax = path.join(payload, 'skills/ui-ux-pro-max');
    const provenance = JSON.parse(fs.readFileSync(path.join(proMax, 'provenance.json'), 'utf8'));
    for (const [file, expected] of Object.entries(provenance.assets)) assert.equal(digest(path.join(proMax, file)), expected, file);
    assert(!fs.existsSync(path.join(payload, 'skills/impeccable')));
    return { skills: selected.length, files, proMaxAssets: Object.keys(provenance.assets).length };
  });
  caseResult('isolated packaged route CLI', () => {
    const input = path.join(project, 'route.json');
    fs.writeFileSync(input, JSON.stringify({ project, ui: true, operation: 'refine', role: 'boss-renderer', affected: ['src/App.tsx'], model: 'gpt-6-astra' }));
    const result = run(path.join(payload, 'skills/prometheus-ui-ux/scripts/cli.mjs'), ['route', '--input', input]);
    assert.equal(result.mode, 'Operate');
    assert(result.skills.includes('prometheus-impeccable-core'));
    assert(result.skills.includes('vercel-react-best-practices'));
    assert(result.applications[0].stacks.includes('electron'));
    assert(!result.skills.some(s => /taste|redesign-existing/.test(s)));
    return { mode: result.mode, stacks: result.applications[0].stacks };
  });
  caseResult('isolated packaged Pro Max search CLI', () => {
    const result = run(path.join(payload, 'skills/ui-ux-pro-max/scripts/search.mjs'), ['keyboard focus navigation', '--domain', 'ux', '--json']);
    assert(result.results?.length > 0, JSON.stringify(result));
    return { results: result.results.length };
  });
  caseResult('packaging command rendering uses real skill-local files', () => {
    const fixtureSource = path.join(temporary, 'render-source');
    const fixtureDest = path.join(temporary, 'render-dest');
    fs.mkdirSync(path.join(fixtureSource, 'skills/local/scripts'), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'versions.toml']) fs.copyFileSync(path.join(source, file), path.join(fixtureSource, file));
    fs.copyFileSync(path.join(source, 'skills/ui-ux-pro-max/scripts/search.mjs'), path.join(fixtureSource, 'skills/local/scripts/search.mjs'));
    fs.writeFileSync(path.join(fixtureSource, 'skills/local/SKILL.md'), 'node scripts/search.mjs\nnode scripts/kbd-status.mjs\n');
    copyPrometheusPayload(fixtureSource, fixtureDest);
    assert.equal(fs.readFileSync(path.join(fixtureDest, 'skills/local/SKILL.md'), 'utf8'), 'node scripts/search.mjs\nboss-mini kbd-status.mjs\n');
    return { localHelper: 'direct Node', packHelper: 'existing boss-mini command' };
  });
  caseResult('Boss installed team check and native preservation', () => {
    const check = run(path.join(boss, '.agents/skills/agent-team-creator/scripts/cli.mjs'), ['install-project', '--project', boss, '--team', 'boss-core', '--check'], boss);
    assert.equal(check.clean, true);
    const installed = JSON.parse(fs.readFileSync(path.join(boss, '.agent-team/boss-core/installation.json'), 'utf8'));
    const nativeFiles = installed.files.filter(file => file.sha256 && file.path.includes('/agents/'));
    for (const file of nativeFiles) assert.equal(digest(path.join(boss, file.path)), file.sha256, file.path);
    const reconciliation = JSON.parse(fs.readFileSync(path.join(boss, '.agent-team/boss-core/reconciliation.json'), 'utf8'));
    const prior = JSON.parse(fs.readFileSync(path.join(reconciliation.sourceCheckout, '.agent-team/boss-core/team.json'), 'utf8'));
    const current = JSON.parse(fs.readFileSync(path.join(boss, '.agent-team/boss-core/team.json'), 'utf8'));
    assert.deepEqual(current.roles.map(r => [r.id, r.owns, r.native]), prior.roles.map(r => [r.id, r.owns, r.native]));
    assert(current.roles.find(r => r.id === 'boss-ux').skills.includes('prometheus-ui-ux'));
    assert(current.roles.find(r => r.id === 'boss-renderer').skills.includes('prometheus-ui-ux'));
    assert(current.roles.find(r => r.id === 'boss-verifier').skills.includes('prometheus-ui-review'));
    return { nativeDefinitionsPreserved: nativeFiles.length, roleIdsAndOwnershipPreserved: current.roles.length };
  });
} catch (error) {
  results.push({ status: 'failed', message: error.message });
  process.exitCode = 1;
}
const evidence = { schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, recordedAt: new Date().toISOString(), source, temporary,
  results, status: process.exitCode ? 'failed' : 'passed', limitations: [
    'No Electron application launch, native harness invocation, independent UI review or full release packaging was performed.',
    'Native Windows and Linux execution remain unverified; this gate ran on the recorded platform only.',
    'Application renderMiniSkill import via existing tsx could not resolve @application outside the Electron build environment; packaged command rendering was exercised through the production copy path.',
    'The offline payload gate covers the UI runtime closure; existing optional OpenSpec/service dependencies are provisioned by the separate release packaging path.'
  ] };
fs.writeFileSync(path.join(boss, '.agent-team/boss-core/ui-routing-packaged-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');

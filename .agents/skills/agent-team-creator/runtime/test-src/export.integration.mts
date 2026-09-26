import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture, team, skillRoot } from './fixture.mjs';

const require = createRequire(path.join(skillRoot, 'runtime', 'package.json'));
const parseToml: (text: string) => Record<string, unknown> = require('smol-toml').parse;
const parseYaml: (text: string) => unknown = require('yaml').parse;

test('packaged guide recommends minimal work and explains editable specialist teams', () => {
  const f = fixture();
  try {
    const questions = f.call('guide', {}); assert.ok(questions.missing.includes('outcome'));
    const request = { id: 'checkout', outcome: 'Accessible checkout', complexity: 'simple', areas: ['code'], deliverables: ['Checkout'], budget: 'balanced', review: false, harness: 'codex', scope: 'project' };
    const pending = f.call('guide', request); assert.equal(pending.ready, false); assert.equal(pending.team, undefined); assert.deepEqual(pending.missing, ['ownership.implementer']);
    const simple = f.call('guide', { ...request, ownership: { implementer: ['src/checkout/**'] } }); assert.equal(simple.team.roles.length, 1); assert.equal(simple.ready, true); assert.deepEqual(simple.team.roles[0].owns, ['src/checkout/**']);
    f.call('validate', { team: simple.team });
    const complex = f.call('guide', { ...request, complexity: 'complex', areas: ['code','design','mobile','security'], review: true, ownership: { implementer:['src/checkout/**'], designer:['design/checkout/**'], 'mobile-specialist':['plans/mobile.md'], 'security-reviewer':['reviews/security.md'], reviewer:['reviews/quality.md'] } });
    assert.ok(complex.team.roles.some((r: {id:string}) => r.id === 'designer'));
    assert.ok(complex.team.roles.some((r: {id:string}) => r.id === 'mobile-specialist'));
    assert.ok(complex.alternatives.length); assert.ok(complex.skillDiscovery);
    assert.ok(complex.team.roles.every((r:{owns:string[]})=>r.owns.length>0));
    f.call('guide', {...request,ownership:null},1); f.call('guide',{...request,ownership:{ghost:['unknown']}},1); f.call('guide',{...request,ownership:{implementer:['../escape']}},1);
    assert.equal(f.call('guide',{...request,ownership:{implementer:[]}}).team,undefined);
    f.call('init', { state: f.state, team: complex.team });
    assert.equal(f.call('status', { state: f.state }).revision, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'copied skill', 'runtime')), false);
  } finally { f.close(); }
});

for (const target of ['uar','bossfang','codex','claude','copilot','kimi','minimax','opencode','deepseek']) {
  test(`packaged export ${target}: parse actual serialized proposals and preserve native files`, () => {
    const f = fixture();
    try {
      const unusual = 'Quoted "value" with newline\nbackslash \\ and ${base_prompt}';
      const manifest = { ...team(), modelPolicy: { model: 'provider/model' },
        roles: team().roles.map(r => ({ ...r, prompt: unusual })),
        native: { [target]: { version: 'source-contract-fixture', source: 'operator-configured', options: { 'opaque-setting': { values: [unusual, 3, true] } }, files: { 'native/custom.txt': unusual } } } };
      const out = path.join(f.root, `proposal-${target}`);
      const result = f.call('export', { team: manifest, target, out });
      assert.equal(result.verification.live, 'unverified');
      assert.equal(fs.readFileSync(path.join(out, 'native/custom.txt'), 'utf8'), unusual);
      const receipt = JSON.parse(fs.readFileSync(path.join(out, 'team-export.json'), 'utf8'));
      assert.ok(receipt.files.length > 1); assert.ok(receipt.diagnostics.length);
      for (const { file } of receipt.files) {
        const content = fs.readFileSync(path.join(out, file), 'utf8');
        if (file.endsWith('.toml')) assert.ok(parseToml(content));
        if (/\.ya?ml$/.test(file)) assert.ok(parseYaml(content));
        if (file.endsWith('.json')) assert.ok(JSON.parse(content));
        if (file.endsWith('.md') && content.startsWith('---\n')) {
          const front = content.match(/^---\n([\s\S]*?)\n---/);assert.ok(front);
          assert.equal(typeof parseYaml(front[1]), 'object');
        }
      }
      if (target === 'codex') {
        const agent = parseToml(fs.readFileSync(path.join(out,'.codex/agents/implementer.toml'),'utf8'));
        assert.ok(String(agent.developer_instructions).startsWith(unusual));
        assert.equal(agent.model, 'provider/model');
      }
      if (target === 'uar') {
        const artifact = JSON.parse(fs.readFileSync(path.join(out,'uar/agents/implementer.json'),'utf8'));
        for (const key of ['metadata','runtime','policy','schemas','prompt','memory','tools','ui']) assert.equal(typeof artifact[key], 'object');
        assert.equal(artifact.runtime.entry, 'default');
      }
      if (target === 'bossfang') {
        const request = JSON.parse(fs.readFileSync(path.join(out,'bossfang/registration/implementer.json'),'utf8'));
        const manifest = parseToml(request.manifest_toml);assert.equal(manifest.skills_disabled, true);
        assert.ok(String((manifest.model as Record<string,unknown>).system_prompt).startsWith(unusual));
      }
      if (target === 'kimi' || target === 'deepseek') assert.ok(result.diagnostics.some((d:string) => /model/.test(d)));
      if (target === 'minimax') assert.ok(result.diagnostics.some((d:string) => /selector/.test(d)));
    } finally { f.close(); }
  });
}

test('export refuses collisions, unsafe paths and overwriting existing proposals', () => {
  const f = fixture();
  try {
    const out = path.join(f.root, 'proposal');
    f.call('export', { team: team(), target: 'codex', out });
    const before = fs.readFileSync(path.join(out, 'team-export.json'));
    f.call('export', { team: team(), target: 'codex', out }, 1);
    assert.deepEqual(fs.readFileSync(path.join(out, 'team-export.json')), before);
    for (const files of [{'.codex/agents/implementer.toml':'collision'},{'A.txt':'one','a.txt':'two'},{'../escape':'bad'},{'CON.txt':'bad'},{'wild*card':'bad'},{'a':'one','a/b':'two'}]) {
      const bad = { ...team(), native: { codex: { source:'operator', version:'recorded', files } } };
      const refused = path.join(f.root,'refused');
      f.call('export', { team: bad, target:'codex', out:refused }, 1);
      assert.equal(fs.existsSync(refused), false);
    }
    const renamed = { ...team(), roles: team().roles.map(r=>({...r,native:{codex:{name:'same-name'}}})) };
    f.call('export',{team:renamed,target:'codex',out:path.join(f.root,'duplicate-name')},1);
  } finally { f.close(); }
});

test('manifest rejects misspelled common fields and dependency cycles; native options remain explicit', () => {
  const f = fixture();
  try {
    for (const key of ['modelPolicy','skillPolicies','native']) f.call('validate',{team:{...team(),[key]:null}},1);
    for (const key of ['modelPolicy','native']) f.call('validate',{team:{...team(),roles:team().roles.map(r=>({...r,[key]:null}))}},1);
    f.call('validate',{team:{...team(),model:'misspelled-common-model'}},1);
    f.call('validate',{team:{...team(),roles:team().roles.map(r=>({...r,dependsOn:[r.id]}))}},1);
    f.call('validate',{team:{...team(),native:{codex:{source:'operator',version:'recorded',unknown:true}}}},1);
    f.call('validate',{team:{...team(),native:{codex:{source:'operator',version:'recorded',options:{futureOption:true}}}}});
  } finally { f.close(); }
});

test('all four shipped skill frontmatters use the AgentSkills standard metadata shape', () => {
  for (const name of ['agent-team-creator','agent-team-manage','agent-team-models','agent-team-handoff']) {
    const file=path.join(skillRoot,'..',name,'SKILL.md');
    const raw=fs.readFileSync(file,'utf8').match(/^---\n([\s\S]*?)\n---/);assert.ok(raw);
    const meta=parseYaml(raw[1]) as Record<string,unknown>;
    assert.equal(meta.name,name); assert.equal(typeof meta.description,'string');
    for(const key of Object.keys(meta))assert.ok(['name','description','license','compatibility','metadata','allowed-tools'].includes(key),key);
    for(const value of Object.values(meta.metadata as Record<string,unknown>))assert.equal(typeof value,'string');
  }
});

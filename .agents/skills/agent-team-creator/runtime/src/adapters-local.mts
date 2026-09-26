import type { Harness, ObjectValue, Team } from './types.mjs';
import { json, markdown, merge, model, object, prompt, toml, yaml } from './adapters-codecs.mjs';
import type { ExportContext } from './adapters-codecs.mjs';

const deferredSkills = new Set(['prometheus-ui-ux', 'prometheus-ui-review', 'interface-review', 'break', 'variant', 'explain-interface']);

export function exportLocal(team: Team, target: Exclude<Harness, 'uar'>, ctx: ExportContext): void {
  const options = team.native?.[target]?.options;
  if (target === 'opencode' && object(options?.agent)) {
    const generatedNames = new Set(team.roles.map(role => role.id.toLowerCase()));
    for (const name of Object.keys(options.agent)) {
      if (generatedNames.has(name.toLowerCase())) {
        throw new Error(`OpenCode agent collision between options.agent and generated Markdown: ${name}. Use the role native override.`);
      }
    }
  }
  const pluginRoot = `plugins/${team.id}`;
  for (const role of team.roles) {
    const native = role.native?.[target] ?? {};
    const selected = model(team, role);
    const modelField: ObjectValue = selected ? { model: selected } : {};
    const body = prompt(team, role);
    const uiReviewer = role.skills.includes('prometheus-ui-review');
    if (target === 'codex') {
      const agent = merge({ name: role.id, description: role.description, developer_instructions: body, ...(uiReviewer ? { sandbox_mode: 'read-only' } : {}), ...modelField }, native);
      const name = ctx.claimName(agent.name);
      ctx.add(`.codex/agents/${name}.toml`, toml(agent));
    } else if (target === 'claude' || target === 'copilot' || target === 'minimax') {
      const preloadSkills = role.skills.filter(skill => !deferredSkills.has(skill));
      const overrideSkills = Array.isArray(native.skills) ? native.skills.filter(skill => typeof skill === 'string' && deferredSkills.has(skill)) : [];
      if (overrideSkills.length) ctx.diagnostics.push(`${role.id}: explicit native.${target}.skills requests conditional or user-only preloads (${overrideSkills.join(', ')}). The override is preserved, but conflicts with conditional UI loading or upstream user-only invocation restrictions; resolve it before native invocation. Direct file reads are not a workaround.`);
      const agent = merge({ name: role.id, description: role.description, ...modelField, skills: preloadSkills,
        ...(uiReviewer && target === 'claude' ? { tools: ['Read', 'Glob', 'Grep'] } : {}) }, native);
      const name = ctx.claimName(agent.name);
      const content = markdown(agent, body);
      const path = target === 'claude' ? `.claude/agents/${name}.md`
        : target === 'copilot' ? `.github/agents/${name}.agent.md` : `agents/${name}/agent.md`;
      ctx.add(path, content);
      if (target === 'claude') {
        ctx.add(`${pluginRoot}/agents/${name}.md`, content);
        const ignored = ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt', 'omitClaudeMd']
          .filter(key => Object.hasOwn(native, key));
        if (ignored.length) ctx.diagnostics.push(`${role.id}: Claude plugin subagents ignore ${ignored.join(', ')}; use the project agent copy for those fields. Values remain preserved in both copies.`);
      }
    } else if (target === 'kimi') {
      const agent = merge({ name: role.id, description: role.description }, native);
      const name = ctx.claimName(agent.name);
      const content = markdown(agent, body);
      ctx.add(`.kimi-code/agents/${name}.md`, content);
      ctx.add(`${pluginRoot}/agents/${name}.md`, content);
      if (selected || Object.hasOwn(native, 'model')) {
        ctx.diagnostics.push(`${role.id}: Kimi ignores role model frontmatter; configure the invocation model pool or global secondary model separately.`);
      }
    } else if (target === 'opencode') {
      // Filename owns the identity; native prompt overrides become the Markdown body.
      const agent = merge({ description: role.description, mode: 'subagent', ...(uiReviewer ? { permission: { edit: 'deny' } } : {}), ...modelField }, native);
      const nativePrompt = agent.prompt;
      if (nativePrompt !== undefined && typeof nativePrompt !== 'string') throw new Error('OpenCode native prompt must be a string.');
      delete agent.prompt;
      ctx.claimName(role.id);
      ctx.add(`.opencode/agents/${role.id}.md`, markdown(agent, nativePrompt ?? body));
    } else if (target === 'deepseek') {
      ctx.claimName(role.id);
      const persona = merge({ prefix: body }, native);
      ctx.add(`.dsh/profiles/${team.id}-${role.id}/cordis.patch.yml`, yaml([
        { insert: [{ id: `${team.id}-${role.id}-persona`, name: '@deepseek-ai/dsh-persona', config: persona }] },
      ]));
      if (selected || Object.hasOwn(native, 'model')) {
        ctx.diagnostics.push(`${role.id}: DeepSeek persona/member configuration cannot select a per-member model; preserved model intent is not applied.`);
      }
    }
  }
  if (target === 'codex') {
    if (options) ctx.add('.codex/config.toml', toml(options));
    ctx.instructions.push('Review and merge .codex/agents and optional .codex/config.toml into the project; config values are native Codex options.');
    ctx.diagnostics.push('Standalone agent files are supported. A Codex plugin agents manifest field is not verified; no such field is emitted.');
  } else if (target === 'claude') {
    if (options) ctx.add('.claude/settings.json', json(options));
    ctx.add(`${pluginRoot}/.claude-plugin/plugin.json`, json({ name: team.id, version: '1.0.0', description: team.outcome }));
    ctx.add('.claude-plugin/marketplace.json', json({
      name: `${team.id}-marketplace`, owner: { name: team.id },
      plugins: [{ name: team.id, source: `./${pluginRoot}`, description: team.outcome }],
    }));
    ctx.instructions.push('Choose project .claude/agents or the staged local marketplace/plugin. Do not install both copies. Settings options are a proposed project .claude/settings.json.');
    ctx.diagnostics.push('These are native subagents; installing them does not create an experimental Claude agent team or enable that feature.');
  } else if (target === 'kimi') {
    ctx.add(`${pluginRoot}/kimi.plugin.json`, json({ name: team.id, version: '1.0.0', description: team.outcome, agents: ['./agents'] }));
    ctx.add('marketplace.json', json({ version: '2', plugins: [{ id: team.id, displayName: team.id, source: `./${pluginRoot}` }] }));
    ctx.instructions.push('Choose project .kimi-code/agents or the staged Kimi v2 marketplace/plugin. Literal ${base_prompt} in supplied prompts remains unchanged.');
    if (options) ctx.diagnostics.push('Kimi team native options are preserved in native-options.json only; no project config location or automatic application is asserted.');
  } else if (target === 'minimax') {
    ctx.instructions.push('Install agents/<name>/agent.md under the active MiniMax user-data directory: MINIMAX_DATA_DIR, MAVIS_DATA_DIR, or default ~/.minimax. Export does not install there.');
    ctx.diagnostics.push('mcode exec has no verified custom-agent selector. The MiniMax plugin manifest supports skills/MCP/hooks/apps, not an agents field; no agent plugin is invented.');
    if (options) ctx.diagnostics.push('MiniMax team native options are preserved in native-options.json only; apply through the installed native configuration interface.');
  } else if (target === 'copilot') {
    ctx.instructions.push('Review .github/agents/*.agent.md; native CLI /agent or --agent selects a custom role. Fleet is a separate native execution mechanism.');
    ctx.diagnostics.push('No Copilot agent marketplace mapping was verified; this export uses native agent files.');
    if (options) ctx.diagnostics.push('Copilot team native options are preserved in native-options.json only; they are not project configuration.');
  } else if (target === 'opencode') {
    if (options) ctx.add('opencode.json', json(options));
    ctx.instructions.push('Review .opencode/agents/*.md and optional opencode.json. Native configuration uses singular agent and permission keys.');
    ctx.diagnostics.push('OpenCode JS/TS or npm plugins are separate from agent definitions; no agent marketplace manifest is invented.');
  } else {
    ctx.add(`.dsh/profiles/${team.id}-team/cordis.patch.yml`, yaml([{ insert: [
      { id: `${team.id}-persistence`, name: '@deepseek-ai/dsh-session-persistence-jsonl' },
      { id: `${team.id}-team`, name: '@deepseek-ai/dsh-experimental-agent-team', config: options ?? {} },
      { id: `${team.id}-team-tools`, name: '@deepseek-ai/dsh-experimental-tool-agent-team' },
    ] }]));
    ctx.instructions.push('Review the role persona profiles and separate team composition profile before selecting them in DeepSeek. Team options configure the experimental agent-team service. The lead creates members at runtime using the portable role prompts; profiles do not pre-create a roster.');
    ctx.diagnostics.push('DeepSeek teams are experimental, require durable session storage, share one process/workspace, and provide no static per-member model setting. No package install, profile activation or team creation occurs on export.');
  }
  ctx.diagnostics.push('Role overrides are preserved without native schema certification. Skill IDs refer to separately installed skills; prompt mentions do not install or authorize them.');
}

import { json, merge, model, prompt, toml } from './adapters-codecs.mjs';
export function exportService(team, target, ctx) {
    const options = team.native?.[target]?.options;
    const registrations = [];
    const handAgents = Object.create(null);
    const steps = [];
    for (const [index, role] of team.roles.entries()) {
        const native = role.native?.[target] ?? {};
        if (target === 'uar') {
            const defaults = {
                version: '1.0.0', kind: 'agent', id: `${team.id}-${role.id}`,
                metadata: { title: role.id, description: role.description, tags: [team.id] },
                runtime: { entry: 'default', protocols: {} },
                policy: {
                    provider: { default: { provider: '', model: model(team, role) ?? '' }, fallbacks: [] },
                    tools: { allow: [], deny: [], max_concurrent: 1, execution_mode: 'direct' },
                    skills: { prefer: role.skills, max_active: 3 },
                },
                schemas: {}, prompt: { system: prompt(team, role), instructions: [] },
                memory: { conversation: { enabled: true }, kb: { enabled: false, knowledge_bases: [], citation_required: false } },
                tools: { bundles: [] }, ui: { forms: { enabled: false }, artifacts: { enabled: false, preferred_types: [] } },
                extensions: {},
            };
            const artifact = merge(merge(defaults, options), native);
            ctx.claimName(artifact.id);
            const path = `uar/agents/${role.id}.json`;
            ctx.add(path, json(artifact));
            registrations.push({ method: 'POST', route: '/api/agents', bodyFile: path, role: role.id });
        }
        else {
            const manifest = merge({
                name: `${team.id}-${role.id}`, description: role.description,
                model: { provider: 'default', model: model(team, role) ?? 'default', system_prompt: prompt(team, role) },
                skills: role.skills, skills_disabled: role.skills.length === 0, mcp_servers: [],
            }, native);
            const name = ctx.claimName(manifest.name);
            const content = toml(manifest);
            ctx.add(`bossfang/agents/${role.id}/agent.toml`, content);
            const path = `bossfang/registration/${role.id}.json`;
            ctx.add(path, json({ manifest_toml: content }));
            registrations.push({ method: 'POST', route: '/api/agents', bodyFile: path, role: role.id });
            handAgents[role.id] = merge({ coordinator: index === 0, invoke_hint: role.description }, manifest);
            steps.push({ name: role.id, agent_name: name, prompt: '{{input}}', depends_on: role.dependsOn });
        }
    }
    if (target === 'bossfang') {
        const hand = merge({ id: team.id, version: '1.0.0', name: team.id, description: team.outcome,
            category: 'development', icon: '', tools: [], skills: [], mcp_servers: [], agents: handAgents }, options);
        const handContent = toml(hand);
        ctx.add(`bossfang/hands/${team.id}/HAND.toml`, handContent);
        ctx.add('bossfang/hand-install.json', json({ toml_content: handContent, skill_content: '' }));
        ctx.add('bossfang/workflow.json', json({ name: team.id, description: team.outcome, steps }));
        ctx.instructions.push('Choose standalone agent registrations plus workflow, or install the Hand. These are distinct native deployment paths; do not activate the Hand as a duplicate of the standalone workflow.');
        ctx.instructions.push('Optional native payloads: POST /api/hands/install with bossfang/hand-install.json; POST /api/workflows with bossfang/workflow.json after registering standalone agents. Hand activation and workflow run require separate authorization and are not performed.');
        ctx.diagnostics.push('Empty portable role skills emit skills_disabled=true; native skills=[] with skills_disabled=false means all. Agent MCP [] means none; ["*"] means all. Hand-level allowlists have their own native defaults.');
        ctx.diagnostics.push('BossFang team native options merge into HAND.toml; role overrides merge into each AgentManifest. Preserve local TOML because native GET returns a projection. Hand activation can start autonomous schedules.');
    }
    else {
        ctx.instructions.push('Each uar/agents/*.json is a complete AgentArtifact body for POST /api/agents. UAR team native options supply artifact defaults, then role native overrides win.');
        ctx.diagnostics.push('UAR skill policy prefer is a preference, not an enforced skill allowlist. Blank provider/model use service defaults; model IDs are not split to guess a provider.');
        ctx.instructions.push('Review native policy.tools.allow and tools.bundles before registration; generated defaults grant no explicit tool allowlist or bundles. Supply required native tool policy through team defaults or role overrides.');
        ctx.diagnostics.push('UAR has no verified persistent team registration API. POST /api/uar/runs requires {artifact:<full AgentArtifact>,input:<task>}; registration does not run it.');
    }
    ctx.add(`${target}/registration-plan.json`, json({ schemaVersion: 1, format: 'agent-team-export-plan',
        execution: 'not-performed', requests: registrations }));
    ctx.instructions.push('registration-plan.json is a local review plan, not a native API body. Supply an operator-approved base URL and credential reference; preserve each returned native ID/outcome because registration is not atomic.');
    ctx.diagnostics.push('Native authentication and registration are unverified. UAR defaults to JWT-required; BossFang accepts Bearer or X-API-Key. Discovery success is not mutation authorization.');
}

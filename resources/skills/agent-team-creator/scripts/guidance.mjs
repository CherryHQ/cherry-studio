import { id, text, strings, target, object } from './validation.mjs';
export const questions = [
    { key: 'id', question: 'What short name should identify this team?' },
    { key: 'outcome', question: 'What should be different when this work is finished?' },
    { key: 'complexity', question: 'Is this one isolated change, or work spanning several components?', choices: ['simple', 'complex'] },
    { key: 'areas', question: 'Which kinds of work are involved?', choices: ['code', 'design', 'mobile', 'security', 'docs', 'marketing', 'product'] },
    { key: 'deliverables', question: 'What files, features, or decisions should the team deliver?' },
    { key: 'budget', question: 'Should we favor lower cost, balanced cost, or capability for difficult work?', choices: ['economy', 'balanced', 'quality'] },
    { key: 'review', question: 'Does this work need an independent reviewer?', choices: ['yes', 'no'] },
    { key: 'harness', question: 'Which coding tool will execute the team?' },
    { key: 'scope', question: 'Will the definitions live in this project, UAR, or BossFang?', choices: ['project', 'uar', 'bossfang'] },
];
const specialists = {
    design: { id: 'designer', why: 'Decide layout, interaction and visual acceptance before implementation.', output: 'Design specification and assets', skills: ['frontend-design', 'impeccable'] },
    mobile: { id: 'mobile-specialist', why: 'Resolve platform navigation, accessibility and device constraints.', output: 'Mobile implementation plan', skills: ['flutter', 'dart'] },
    security: { id: 'security-reviewer', why: 'Review the actual trust boundaries and required controls.', output: 'Threat model and evidence-backed findings', skills: ['agent-runtime-security'] },
    docs: { id: 'documentation-specialist', why: 'Keep operator and developer instructions consistent with the delivered behavior.', output: 'Updated documentation', skills: ['documentation-and-adrs'] },
    marketing: { id: 'marketing-specialist', why: 'Develop audience, positioning and measurable campaign deliverables.', output: 'Campaign brief and copy', skills: ['brand'] },
    product: { id: 'product-manager', why: 'Translate desired outcomes into priorities and acceptance criteria.', output: 'Prioritized requirements', skills: ['domain-modeling'] },
};
export function guide(input) {
    const required = ['id', 'outcome', 'complexity', 'areas', 'deliverables', 'budget', 'review', 'harness', 'scope'];
    const missing = required.filter(k => input[k] === undefined);
    if (missing.length)
        return { questions, missing };
    const teamId = id(input.id), outcome = text(input.outcome, 'outcome');
    const areas = strings(input.areas, 'areas'), deliverables = strings(input.deliverables, 'deliverables');
    if (!['simple', 'complex'].includes(String(input.complexity)))
        throw Error('complexity must be simple or complex');
    if (!['economy', 'balanced', 'quality'].includes(String(input.budget)))
        throw Error('Invalid budget preference');
    if (typeof input.review !== 'boolean')
        throw Error('review must be boolean');
    if (areas.some(a => !['code', ...Object.keys(specialists)].includes(a)))
        throw Error('Unknown work area');
    const harness = target(input.harness);
    if (harness === 'bossfang')
        throw Error('Use scope=bossfang and choose the executing harness separately');
    if (!['project', 'uar', 'bossfang'].includes(String(input.scope)))
        throw Error('Invalid scope');
    const tier = input.budget === 'quality' ? 'hard' : input.budget === 'economy' ? 'low' : 'medium';
    const roles = [{ id: 'implementer', description: 'Deliver the requested outcome within assigned scope.', prompt: `Deliver: ${outcome}. Coordinate ownership before editing. Report evidence and remaining work.`, skills: [], owns: [], inputs: ['Task and acceptance criteria'], outputs: deliverables, dependsOn: [], modelPolicy: { tier } }];
    const reasons = ['An implementer owns delivery. Assign concrete output paths before creating the team; suggested roles can be reduced.'];
    if (input.complexity === 'complex')
        for (const area of [...new Set(areas)]) {
            const spec = specialists[area];
            if (!spec)
                continue;
            roles.push({ id: spec.id, description: spec.why, prompt: `${spec.why} Outcome: ${outcome}. Stay within assigned scope and return concrete evidence.`, skills: spec.skills, owns: [], inputs: ['Task context'], outputs: [spec.output], dependsOn: [], modelPolicy: { tier: area === 'security' ? 'hard' : tier } });
            reasons.push(`${spec.id}: ${spec.why}`);
        }
    if (input.review) {
        roles.push({ id: 'reviewer', description: 'Independently verify acceptance criteria and code quality.', prompt: 'Inspect the delivered diff and actual verification evidence. Report concrete defects; do not rewrite implementation while reviewing.', skills: ['code-review-and-quality'], owns: [], inputs: ['Implementation diff', 'Verification evidence'], outputs: ['Review findings'], dependsOn: roles.map(r => r.id), modelPolicy: { tier: 'hard' } });
        reasons.push('An independent reviewer adds a separate verification pass and extra model cost.');
    }
    const ownership = input.ownership === undefined ? {} : object(input.ownership, 'ownership');
    for (const key of Object.keys(ownership))
        if (!roles.some(r => r.id === key))
            throw Error('Unknown ownership role: ' + key);
    for (const role of roles)
        if (ownership[role.id] !== undefined) {
            role.owns = strings(ownership[role.id], 'ownership.' + role.id);
            for (const owned of role.owns)
                if (owned.startsWith('/') || owned.includes('\\') || owned.includes(':') || owned.split('/').some(p => p === '..' || p === '.' || !p))
                    throw Error('Ownership must use project-relative paths or globs: ' + owned);
        }
    const unresolved = roles.filter(r => r.owns.length === 0);
    const alternatives = ['Use one implementer for sequential work; invoke specialist skills as needed.', 'Add parallel roles only where work and file ownership can be separated.'];
    const skillDiscovery = 'Skill names are suggestions, not installation claims. Discover installed AgentSkills, inspect their source and requirements, and replace or remove unavailable skills before export.';
    if (unresolved.length)
        return { ready: false, proposedRoles: roles, reasons, alternatives, skillDiscovery,
            missing: unresolved.map(r => 'ownership.' + r.id),
            questions: unresolved.map(r => ({ key: 'ownership.' + r.id, question: 'Which project-relative files or output directories may ' + r.id + ' write? For read-only review, assign a separate findings path. Inspect the project and suggest paths instead of guessing.' })) };
    return { ready: true, questions: [], team: { schemaVersion: 1, id: teamId, outcome, scope: input.scope, harness, roles, modelPolicy: { tier } }, reasons,
        alternatives, skillDiscovery };
}

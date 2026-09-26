import type { Role, Team } from './types.mjs';

const direction = /\b(design(?:er)?|creative director|ux|ui|frontend|front-end|renderer|mobile|swiftui|flutter|compose)\b/i;
const review = /\b(review(?:er)?|verif(?:y|ier)|auditor)\b/i;
const taste = new Set(['gpt-taste', 'design-taste-frontend', 'design-taste-frontend-v1', 'redesign-existing-projects', 'high-end-visual-design', 'minimalist-ui', 'industrial-brutalist-ui', 'stitch-design-taste']);

/** Bind a router, not an unconditional pile of aesthetic skills. */
export function bindUiRoles(source: Team): Team {
  const team = structuredClone(source);
  const uiTeam = team.roles.some(r => direction.test(`${r.id} ${r.description} ${r.skills.join(' ')}`));
  for (const role of team.roles) {
    const identity = `${role.id} ${role.description}`;
    const reviewer = review.test(identity);
    if (reviewer && (uiTeam || direction.test(identity))) {
      role.skills = role.skills.filter(skill => !taste.has(skill) && skill !== 'prometheus-ui-ux');
      role.skills = [...new Set([...role.skills, 'prometheus-ui-review'])];
    } else if (!reviewer && direction.test(`${identity} ${role.skills.join(' ')}`)) {
      role.skills = [...new Set([...role.skills.filter(skill => !taste.has(skill)), 'prometheus-ui-ux'])];
    }
  }
  return team;
}

export function uiRoleInstructions(role: Role): string {
  if (role.skills.includes('prometheus-ui-review')) return '\nFor UI review only, load prometheus-ui-review. Review at the completed phase boundary in a separate context. Never load taste skills, redesign the surface, or bypass user-only skill restrictions. Backend work does not activate UI guidance.';
  if (role.skills.includes('prometheus-ui-ux')) return '\nFor UI work only, load prometheus-ui-ux and the project .agents/UI_UX_PROTOCOL.md override if present. Preserve existing design authority; route by affected application and actual model. Creative/design roles establish context and direction; implementation roles select craft and platform guidance. Backend work does not activate UI guidance.';
  return '';
}

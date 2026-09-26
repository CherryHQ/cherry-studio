import fs from 'node:fs';
import { projectFile, readFile, stage, type Change } from './project-files.mjs';

const start = '<!-- prometheus-team-routing:start v1 -->';
const end = '<!-- prometheus-team-routing:end -->';
export const zedPriority = ['.rules', '.cursorrules', '.windsurfrules', '.clinerules', '.github/copilot-instructions.md', 'AGENT.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

function merge(content: string, body: string): string {
  const starts = content.split(start).length - 1, ends = content.split(end).length - 1;
  if (starts !== ends || starts > 1 || (starts && content.indexOf(end) < content.indexOf(start)) ||
      (content.match(/<!-- prometheus-team-routing:/g)?.length ?? 0) !== starts + ends) throw Error('Corrupt prometheus-team-routing markers; no project files were written');
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const block = `${start}\n${body}\n${end}`.replace(/\n/g, newline);
  if (starts) return content.slice(0, content.indexOf(start)) + block + content.slice(content.indexOf(end) + end.length);
  return content + (content.length && !content.endsWith('\n') ? newline : '') + (content.length ? newline : '') + block + newline;
}

export function instructionChanges(root: string, changes: Map<string, Change>, includeZed: boolean): string[] {
  const body = 'For every code task, read `.agent-team/project-routing.json`, then its active team manifest and the relevant role instructions. Default to that team, selecting only roles whose responsibilities and ownership match the work. Preserve native permissions, models, concurrency limits and existing project instructions.\n' +
    'For UI work, load the role-bound `prometheus-ui-ux` or `prometheus-ui-review` skill. Prefer `.agents/UI_UX_PROTOCOL.md` when present; otherwise use the installed `prometheus-ui-ux/references/UI_UX_PROTOCOL.md`. Backend work must not load UI guidance.\n' +
    'Use native delegation when available. If unavailable, follow the selected role instructions sequentially and report that limitation. Review in the builder context is not independent review. Keep reviewers dormant until the complete implementation phase; allow one batched correction/confirmation cycle. Respect user-only skill invocation restrictions. Zed external ACP agents use their own native configuration; parallel UI threads are not an automatic delegation API.';
  const files = ['AGENTS.md', 'CLAUDE.md'];
  if (includeZed) files.push(zedPriority.find(file => fs.existsSync(projectFile(root, file))) ?? 'AGENTS.md');
  const visited = new Set<string>();
  for (const file of files) {
    const absolute = projectFile(root, file);
    if (visited.has(absolute)) continue;
    visited.add(absolute);
    stage(changes, root, file, merge(readFile(absolute) ?? '', body));
  }
  return [...new Set(files)];
}

const untruncated = new Set(['Code Example Good', 'Code Example Bad', 'Code Good', 'Code Bad', 'Implementation Checklist', 'Design System Variables', 'CSS Import', 'Tailwind Config', 'GSAP Snippet']);
export function formatOutput(result, full = false) {
    if (result.error)
        return `Error: ${result.error}`;
    const lines = result.stack ? ['## UI Pro Max Stack Guidelines', `**Stack:** ${result.stack} | **Query:** ${result.query}`] : ['## UI Pro Max Search Results', `**Domain:** ${result.domain}${result.auto_detected ? ` (auto-detected${result.runner_up_domain ? `, runner-up: ${result.runner_up_domain}` : ''})` : ''} | **Query:** ${result.query}`];
    lines.push(`**Source:** ${result.file} | **Found:** ${result.count} results\n`);
    if (!result.count) {
        if (result.redirect)
            lines.push(`This legacy style label is now modeled in the \`${result.redirect.domain}\` domain as \`${result.redirect.id}\`. Search that domain instead of treating a page composition as a visual style.`);
        else {
            lines.push('No matches. This is not a match with an empty value -- the query did not hit the database. Retry with broader/different keywords before falling back to general defaults, and say explicitly that no database match was found if you do fall back.');
            if (result.suggestions?.length)
                lines.push(`**Closest known terms:** ${result.suggestions.join(', ')}`);
        }
        return lines.join('\n');
    }
    for (const [i, row] of (result.results ?? []).entries()) {
        lines.push(`### Result ${i + 1}`);
        for (const [key, value] of Object.entries(row))
            lines.push(`- **${key}:** ${!full && !untruncated.has(key) && value.length > 300 ? `${value.slice(0, 300)}...` : value}`);
        lines.push('');
    }
    return lines.join('\n');
}
// Intentionally portable presentation; machine-readable values retain upstream shape.
export function formatMarkdown(system) {
    const lines = [`# ${system.project_name} — Design System Recommendation`, '', 'Recommendations must be reconciled with the incumbent design authority before adoption.', ''];
    for (const [name, value] of Object.entries(system)) {
        if (name === 'project_name')
            continue;
        lines.push(`## ${name.replaceAll('_', ' ')}`, '');
        if (value === null)
            lines.push('Not specified.');
        else if (typeof value === 'object') {
            if (Array.isArray(value))
                lines.push(...value.map(v => `- ${typeof v === 'string' ? v : JSON.stringify(v)}`));
            else
                for (const [key, item] of Object.entries(value))
                    lines.push(`- **${key.replaceAll('_', ' ')}:** ${typeof item === 'object' ? JSON.stringify(item) : String(item ?? '')}`);
        }
        else
            lines.push(String(value));
        lines.push('');
    }
    return lines.join('\n');
}
export function formatAscii(system) { return formatMarkdown(system).replace(/^#{1,2} /gm, '').replace(/\*\*/g, ''); }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const START = '<!-- uiux-routing:start v1 -->', END = '<!-- uiux-routing:end -->';
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
export function safeTarget(root, file) {
    if (!inside(root, file))
        throw new Error('destination escapes project: ' + file);
    let parent = file;
    while (!fs.existsSync(parent)) {
        if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink())
            throw new Error('broken linked destination: ' + file);
        parent = path.dirname(parent);
    }
    const resolved = fs.realpathSync(parent);
    if (!inside(root, resolved))
        throw new Error('linked destination escapes project: ' + file);
    return path.join(resolved, path.relative(parent, file));
}
export function splicePointer(text, pointer) {
    const starts = text.split(START).length - 1, ends = text.split(END).length - 1;
    if (starts !== ends || starts > 1 || (starts === 1 && text.indexOf(END) < text.indexOf(START)) || (text.match(/<!-- uiux-routing:/g)?.length ?? 0) !== starts + ends)
        throw new Error('corrupt UI routing markers');
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const block = pointer.trimEnd().replaceAll('\r\n', '\n').replaceAll('\n', newline);
    if (starts)
        return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
    return text + (text.endsWith('\n') || !text ? '' : newline) + (text ? newline : '') + block + newline;
}
function walk(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
        if (e.name === 'node_modules' || e.name === 'runtime' || e.name === 'tests')
            return [];
        const file = path.join(dir, e.name);
        if (e.isSymbolicLink())
            throw new Error('bundled skill contains symlink: ' + file);
        return e.isDirectory() ? walk(file, base) : [path.relative(base, file)];
    });
}
function catalogPath(skillRoot) {
    const candidates = [path.join(skillRoot, 'references/catalog.lock.json'), path.join(skillRoot, '../catalog.lock.json'), path.join(skillRoot, '../../references/ui-ux/catalog.lock.json')];
    return candidates.find(f => fs.existsSync(f));
}
export function planInstallation(options) {
    const root = fs.realpathSync(options.project), plan = new Map();
    function add(file, content) {
        const target = safeTarget(root, file);
        const before = options.pending?.get(target) ?? (fs.existsSync(target) ? fs.readFileSync(target) : null);
        if (before?.equals(content))
            return;
        plan.set(target, { file: target, content, before });
    }
    const pointer = fs.readFileSync(path.join(options.skillRoot, 'references/pointer.md'), 'utf8');
    for (const name of options.target && options.target !== 'both' ? [options.target] : ['AGENTS.md', 'CLAUDE.md']) {
        if (!['AGENTS.md', 'CLAUDE.md'].includes(name))
            throw new Error('unsupported instruction target');
        let target = safeTarget(root, path.join(root, name));
        let before = options.pending?.get(target) ?? (fs.existsSync(target) ? fs.readFileSync(target) : Buffer.from(''));
        if (['CLAUDE.md', 'AGENTS.md'].includes(before.toString().trim())) {
            target = safeTarget(root, path.join(root, before.toString().trim()));
            before = options.pending?.get(target) ?? (fs.existsSync(target) ? fs.readFileSync(target) : Buffer.from(''));
        }
        add(target, Buffer.from(splicePointer(before.toString(), pointer)));
    }
    const bundled = fs.readFileSync(path.join(options.skillRoot, 'references/UI_UX_PROTOCOL.md'));
    const protocol = path.join(root, '.agents/UI_UX_PROTOCOL.md');
    if (!fs.existsSync(protocol))
        add(protocol, bundled);
    const catalogFile = catalogPath(options.skillRoot);
    if (!catalogFile)
        throw new Error('bundled UI catalog missing');
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    const ids = ['prometheus-ui-ux', 'prometheus-ui-review', 'prometheus-impeccable-core', 'ui-ux-pro-max',
        ...catalog.skills.filter((s) => s.mini?.status === 'portable' || s.mini?.status === 'adapted' || s.mini?.included === true).map((s) => s.id)];
    // Catalog entries may describe portability with status strings; only present portable siblings are copied.
    for (const entry of catalog.skills) {
        if (entry.mini?.path && !/excluded|full.only|deferred|unavailable/.test(entry.mini.status ?? ''))
            ids.push(entry.id);
    }
    for (const id of new Set(ids)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
            throw new Error('invalid catalog skill id');
        const source = path.resolve(options.skillRoot, '..', id);
        if (!fs.existsSync(path.join(source, 'SKILL.md')))
            throw new Error('missing bundled UI skill: ' + id);
        for (const relative of walk(source))
            for (const harness of ['.agents', '.claude'])
                add(path.join(root, harness, 'skills', id, relative), fs.readFileSync(path.join(source, relative)));
    }
    add(path.join(root, '.agents/skills/prometheus-ui-ux/references/catalog.lock.json'), fs.readFileSync(catalogFile));
    return [...plan.values()];
}
export function applyWrites(project, writes, options = {}) {
    const root = fs.realpathSync(project);
    const changed = writes.filter(w => !fs.existsSync(w.file) || !fs.readFileSync(w.file).equals(w.content));
    for (const w of changed)
        safeTarget(root, w.file);
    if (!options.dryRun && !options.check && changed.length) {
        const id = crypto.createHash('sha256').update(changed.map(w => w.file + w.content.toString('base64')).join('\n')).digest('hex').slice(0, 16);
        const backup = safeTarget(root, path.join(root, '.prometheus/recovery/uiux-' + id + '.json'));
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        if (!fs.existsSync(backup))
            fs.writeFileSync(backup, JSON.stringify({ schemaVersion: 1, files: changed.map(w => ({ path: path.relative(root, w.file), before: w.before?.toString('base64') ?? null, encoding: 'base64' })) }, null, 2) + '\n');
        for (const w of changed) {
            fs.mkdirSync(path.dirname(w.file), { recursive: true });
            const temp = w.file + '.prometheus-' + crypto.randomBytes(6).toString('hex');
            fs.writeFileSync(temp, w.content, { flag: 'wx' });
            fs.renameSync(temp, w.file);
        }
    }
    return { changed: changed.length, drift: changed.map(w => path.relative(root, w.file)), mode: options.check ? 'check' : options.dryRun ? 'dry-run' : 'install' };
}
export function install(options) { return applyWrites(options.project, planInstallation(options), options); }

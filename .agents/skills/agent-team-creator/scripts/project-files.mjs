import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { relativeFile } from './validation.mjs';
export const hash = (text) => createHash('sha256').update(text).digest('hex');
/** Resolve existing links without allowing an instruction/config write outside the project. */
export function projectFile(root, file) {
    relativeFile(file);
    let current = root;
    for (const part of file.split('/')) {
        current = path.join(current, part);
        try {
            current = fs.realpathSync(current);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            try {
                if (fs.lstatSync(current).isSymbolicLink())
                    throw Error(`Broken project link cannot be safely updated: ${file}`);
            }
            catch (missing) {
                if (missing.code !== 'ENOENT')
                    throw missing;
            }
        }
        const rel = path.relative(root, current);
        if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
            throw Error(`Project path escapes through a link: ${file}`);
    }
    return current;
}
export function readFile(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
export function stage(changes, root, file, content) {
    const absolute = projectFile(root, file);
    const prior = changes.get(absolute);
    if (prior && prior.after !== content)
        throw Error(`Conflicting writes to linked project file: ${file}`);
    const before = readFile(absolute);
    if (before !== content)
        changes.set(absolute, { file, absolute, before, after: content });
}
export function commitChanges(root, changes) {
    if (!changes.length)
        return null;
    const receiptId = hash(JSON.stringify(changes.map(c => [c.file, c.before, c.after]))).slice(0, 24);
    const recovery = `.agent-team/recovery/${receiptId}.json`;
    const recoveryFile = projectFile(root, recovery);
    // Recovery is inspectable and contains exact previous bytes before the first edit.
    const receipt = JSON.stringify({ schemaVersion: 1, files: changes.map(c => ({ file: path.relative(root, c.absolute).split(path.sep).join('/'), before: c.before, afterSha256: hash(c.after) })) }, null, 2) + '\n';
    const existing = readFile(recoveryFile);
    if (existing !== null && existing !== receipt)
        throw Error('Recovery receipt collision');
    fs.mkdirSync(path.dirname(recoveryFile), { recursive: true });
    if (existing === null)
        fs.writeFileSync(recoveryFile, receipt, { flag: 'wx' });
    const written = [];
    try {
        for (const change of changes) {
            if (readFile(change.absolute) !== change.before)
                throw Error(`Project changed after preflight: ${change.file}`);
            fs.mkdirSync(path.dirname(change.absolute), { recursive: true });
            fs.writeFileSync(change.absolute, change.after);
            written.push(change);
        }
    }
    catch (error) {
        for (const change of written.reverse()) {
            if (change.before === null)
                fs.unlinkSync(change.absolute);
            else
                fs.writeFileSync(change.absolute, change.before);
        }
        throw error;
    }
    return recovery;
}

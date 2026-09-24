import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { integer, validateMutation, validateState } from './state-validation.mjs';
export { taskAction } from './state-tasks.mjs';
export { completeKbdTask } from './state-kbd.mjs';
function statePath(file, createDirectory = false) {
    const absolute = resolve(file);
    if (createDirectory)
        mkdirSync(dirname(absolute), { recursive: true });
    const path = join(realpathSync(dirname(absolute)), basename(absolute));
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()))
        throw new Error('State must be a regular file, not a symlink');
    return path;
}
function lock(file) {
    const path = `${file}.lock`;
    const token = randomUUID();
    let fd;
    try {
        fd = openSync(path, 'wx', 0o600);
    }
    catch (error) {
        if (error.code === 'EEXIST')
            throw new Error(`State lock held: ${path}. No automatic stale-lock takeover; inspect the recorded owner before manual recovery.`);
        throw error;
    }
    try {
        writeFileSync(fd, JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() }));
        fsyncSync(fd);
    }
    catch (error) {
        closeSync(fd);
        rmSync(path, { force: true });
        throw error;
    }
    closeSync(fd);
    return () => {
        try {
            if (JSON.parse(readFileSync(path, 'utf8')).token === token)
                rmSync(path);
        }
        catch { /* A removed/replaced lock is never stolen from another writer. */ }
    };
}
function atomicWrite(file, state) {
    const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    try {
        writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
        fsyncSync(fd);
    }
    catch (error) {
        closeSync(fd);
        rmSync(temporary, { force: true });
        throw error;
    }
    closeSync(fd);
    try {
        for (let attempt = 0;; attempt++) {
            try {
                renameSync(temporary, file);
                break;
            }
            catch (error) {
                const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error.code ?? '');
                if (process.platform !== 'win32' || !transient || attempt >= 6)
                    throw error;
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * 2 ** attempt);
            }
        }
    }
    finally {
        rmSync(temporary, { force: true });
    }
}
export function readState(file) {
    return validateState(JSON.parse(readFileSync(statePath(file), 'utf8')));
}
export function initState(file, team) {
    const path = statePath(file, true);
    const release = lock(path);
    try {
        if (existsSync(path))
            throw new Error(`State already exists: ${path}`);
        const state = validateState({ schemaVersion: 1, revision: 0, team: structuredClone(team), tasks: [], handoffs: [], outbox: [], events: [] });
        atomicWrite(path, state);
        return state;
    }
    finally {
        release();
    }
}
function prepare(file, expectedRevision) {
    integer(expectedRevision, 'expectedRevision');
    const before = readState(file);
    if (before.revision !== expectedRevision)
        throw new Error(`State revision conflict: expected ${expectedRevision}, current ${before.revision}`);
    if (before.revision === Number.MAX_SAFE_INTEGER)
        throw new Error('State revision exhausted');
    return { before, state: structuredClone(before) };
}
function commit(file, before, state) {
    validateMutation(before, state);
    if (JSON.stringify(before) === JSON.stringify(state))
        return state;
    state.revision = before.revision + 1;
    atomicWrite(file, state);
    return state;
}
export function mutateState(file, expectedRevision, callback) {
    const path = statePath(file);
    const release = lock(path);
    try {
        const { before, state } = prepare(path, expectedRevision);
        const result = callback(state);
        if (result && typeof result.then === 'function')
            throw new Error('Async callback requires mutateStateAsync');
        return commit(path, before, state);
    }
    finally {
        release();
    }
}
export async function mutateStateAsync(file, expectedRevision, callback) {
    const path = statePath(file);
    const release = lock(path);
    try {
        const { before, state } = prepare(path, expectedRevision);
        await callback(state);
        return commit(path, before, state);
    }
    finally {
        release();
    }
}

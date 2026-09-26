import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export const skillRoot = fileURLToPath(new URL('../', import.meta.url));
export function team() {
    return { schemaVersion: 1, id: 'example', outcome: 'Deliver a verified feature', scope: 'project', harness: 'codex',
        roles: ['implementer', 'reviewer'].map(id => ({ id, description: `${id} responsibility`, prompt: 'Read instructions. Report evidence.', skills: [], owns: id === 'implementer' ? ['src/feature/'] : [], inputs: ['Requirements'], outputs: ['Evidence'], dependsOn: [] })) };
}
export function fixture() {
    const scratch = path.resolve('.scratch');
    fs.mkdirSync(scratch, { recursive: true });
    const root = fs.mkdtempSync(path.join(scratch, 'team-cli-'));
    const scripts = path.join(root, 'copied skill', 'scripts');
    fs.cpSync(path.join(skillRoot, 'scripts'), scripts, { recursive: true });
    const cli = path.join(scripts, 'cli.mjs');
    const state = path.join(root, 'state.json');
    function request(input) {
        const file = path.join(root, `request-${randomUUID()}.json`);
        fs.writeFileSync(file, JSON.stringify(input));
        return file;
    }
    function call(command, input, expected = 0, env = process.env) {
        const result = spawnSync(process.execPath, [cli, command, '--input', request(input)], { cwd: root, env, encoding: 'utf8', shell: false, maxBuffer: 20 * 1024 * 1024 });
        assert.equal(result.status, expected, `${command}: ${result.stderr}\n${result.stdout}`);
        return JSON.parse(expected === 0 ? result.stdout : result.stderr);
    }
    function concurrent(command, input) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [cli, command, '--input', request(input)], { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            child.stdout.on('data', b => stdout += b);
            child.stderr.on('data', b => stderr += b);
            child.on('error', reject);
            child.on('exit', status => resolve({ status, stdout, stderr }));
        });
    }
    return { root, cli, state, call, concurrent,
        read: () => JSON.parse(fs.readFileSync(state, 'utf8')),
        close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

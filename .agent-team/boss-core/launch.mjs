import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [harness, ...forwarded] = process.argv.slice(2);
const binaries = { codex: 'codex', claude: 'claude', kimi: 'kimi', opencode: 'opencode', minimax: 'mcode' };

if (!harness || harness === '--help' || harness === '-h') {
  console.log('Usage: node .agent-team/boss-core/launch.mjs <codex|claude|kimi|opencode|minimax> [native CLI arguments]');
  console.log('Runs in The Boss project. Kimi defaults to kimi-code/k3; MiniMax uses the project .minimax data directory.');
} else if (!Object.hasOwn(binaries, harness)) {
  console.error(`Unknown harness: ${harness}`);
  process.exitCode = 2;
} else {
  const args = [...forwarded];
  if (harness === 'codex') args.unshift('-C', root);
  if (harness === 'kimi' && !args.some((arg) => arg === '--model' || arg.startsWith('--model=') || arg === '-m' || /^-m[^-]/u.test(arg))) {
    args.unshift('--model', 'kimi-code/k3');
  }
  const env = harness === 'minimax'
    ? { ...process.env, MINIMAX_DATA_DIR: fileURLToPath(new URL('../../.minimax/', import.meta.url)) }
    : process.env;
  let command = binaries[harness];
  if (harness === 'minimax') {
    const entry = (process.env.PATH ?? '').split(delimiter)
      .map((dir) => join(dir, 'mcode')).find((candidate) => existsSync(candidate));
    if (entry && existsSync(join(dirname(entry), 'node')) && realpathSync(entry).endsWith('.js')) {
      // Keep native SQLite on the Node installation that owns mcode.
      command = join(dirname(entry), 'node');
      args.unshift(realpathSync(entry));
      env.PATH = dirname(command) + delimiter + (env.PATH ?? '');
    }
  }
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: false });
  child.on('error', (error) => {
    console.error(error.code === 'ENOENT'
      ? `${binaries[harness]} is not installed on PATH. This launcher does not install CLI tools.`
      : `Could not start ${binaries[harness]} (${error.code ?? 'launch error'}).`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

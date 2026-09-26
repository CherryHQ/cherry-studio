import fs from 'node:fs';
import path from 'node:path';
import { guide } from './guidance.mjs';
import { validateTeam, object, text, strings, asJson, target } from './validation.mjs';
import { exportTeam } from './adapters.mjs';
import { writeExport } from './export-files.mjs';
import { installProject } from './project-install.mjs';
import { bindUiRoles } from './ui-bindings.mjs';
import { readState, initState, mutateState, mutateStateAsync, taskAction, completeKbdTask } from './state.mjs';
import { createHandoff, acceptHandoff } from './handoff.mjs';
import { discoverModels, selectModel } from './models.mjs';
import { queueMemory, publishMemory } from './memory.mjs';
import type { ObjectValue, ModelPolicy, Json } from './types.mjs';

function revision(input: ObjectValue): number {
  const r = input.expectedRevision;
  if (!Number.isSafeInteger(r) || Number(r) < 0) throw Error('expectedRevision must be a nonnegative integer from the current state');
  return r as number;
}
const stateFile = (input: ObjectValue): string => path.resolve(text(input.state, 'state'));

async function dispatch(command: string, input: ObjectValue): Promise<unknown> {
  switch (command) {
    case 'guide': return guide(input);
    case 'validate': return { valid: true, team: validateTeam(input.team) };
    case 'init': return initState(stateFile(input), bindUiRoles(validateTeam(input.team)));
    case 'install-project': return installProject(input);
    case 'status': return readState(stateFile(input));
    case 'team-update': return mutateState(stateFile(input), revision(input), state => {
      const team = validateTeam(input.team);
      if (team.id !== state.team.id) throw Error('team-update cannot change team identity');
      if (state.tasks.some(t => !team.roles.some(r => r.id === t.owner))) throw Error('Cannot remove a role referenced by a task; preserve history and reassign active work explicitly');
      state.team = team;
    });
    case 'export': {
      const team = validateTeam(input.team ?? readState(stateFile(input)).team);
      const result = exportTeam(team, target(input.target ?? team.harness));
      for (const role of team.roles) if (!role.owns.length) result.diagnostics.push(`${role.id}: file ownership is not yet assigned; resolve it before parallel edits.`);
      return { ...writeExport(text(input.out, 'out'), result), verification: result.verification, diagnostics: result.diagnostics, instructions: result.instructions };
    }
    case 'task': return mutateState(stateFile(input), revision(input), state => taskAction(state, object(input.task, 'task action')));
    case 'complete-kbd': return mutateState(stateFile(input), revision(input), state => {
      completeKbdTask(state, object(input.task, 'task action'), text(input.cwd, 'cwd'));
    });
    case 'handoff-create': return mutateState(stateFile(input), revision(input), state => {
      createHandoff(state, object(input.handoff, 'handoff'), text(input.cwd, 'cwd'));
    });
    case 'handoff-accept': return mutateState(stateFile(input), revision(input), state => {
      const destination = object(input.destination, 'destination');
      const harness = target(destination.harness);
      if (harness === 'bossfang') throw Error('Destination harness must name an execution harness');
      acceptHandoff(state, text(input.id, 'handoff id'), { owner: text(destination.owner, 'destination owner'), harness });
    });
    case 'models-discover': return discoverModels(input);
    case 'models-select': return selectModel(validateTeam(input.team), text(input.roleId, 'roleId'), strings(input.skills ?? [], 'skills'), (input.taskPolicy ?? {}) as ModelPolicy, input.catalog);
    case 'memory-queue': return mutateState(stateFile(input), revision(input), state => { queueMemory(state, object(input.entry, 'entry')); });
    case 'memory-publish': {
      let receipt: Json = null;
      const state = await mutateStateAsync(stateFile(input), revision(input), async state => { receipt = await publishMemory(state, object(input.publication, 'publication')); });
      return { state, publication: receipt };
    }
    default: throw Error(`Unknown command: ${command}`);
  }
}

const commands = ['guide','validate','init','status','team-update','export','install-project','task','complete-kbd','handoff-create','handoff-accept','models-discover','models-select','memory-queue','memory-publish'];
async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required');
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    process.stdout.write(JSON.stringify({ usage: 'node <skill>/scripts/cli.mjs <command> --input <request.json>', commands, note: 'JSON requests preserve spaces and native configuration. Export stages files; it does not install or execute agents.' }, null, 2) + '\n');
    return;
  }
  let input: ObjectValue = {};
  if (args[0] === '--input' && args[1]) {
    input = object(JSON.parse(fs.readFileSync(args[1], 'utf8').replace(/^\uFEFF/, '')));
    args.splice(0, 2);
  } else if (command !== 'install-project') throw Error('Expected <command> --input <request.json>');
  if (command === 'install-project') while (args.length) {
    const flag = args.shift();
    if (flag === '--check') input.check = true;
    else if (flag === '--dry-run') input.dryRun = true;
    else if (['--project', '--team', '--target'].includes(flag ?? '')) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
      input[flag === '--team' ? 'teamId' : flag!.slice(2)] = value;
    } else throw Error(`Unknown install-project option: ${flag}`);
  }
  if (args.length) throw Error('Unexpected arguments');
  const result = asJson(await dispatch(command, input));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (command === 'install-project' && input.check === true && object(result).clean === false) process.exitCode = 2;
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Operation failed' }) + '\n');
  process.exitCode = 1;
});

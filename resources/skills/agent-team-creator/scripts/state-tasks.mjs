import { randomUUID } from 'node:crypto';
import { harness, integer, object, owner, strings, text, validateState } from './state-validation.mjs';
export function recordEvent(state, kind, detail) {
    state.events.push({ id: randomUUID(), at: new Date().toISOString(), kind, detail });
}
export function checkedTask(state, input) {
    const id = text(input.id ?? input.taskId, 'task id');
    const task = state.tasks.find(candidate => candidate.id === id);
    if (!task)
        throw new Error(`Unknown task: ${id}`);
    if (owner(state, input.owner) !== task.owner)
        throw new Error(`Task ${id} belongs to ${task.owner}`);
    if (integer(input.expectedTaskRevision, 'expectedTaskRevision') !== task.revision)
        throw new Error(`Task revision conflict: ${id} is at ${task.revision}`);
    if (['complete', 'cancelled'].includes(task.status))
        throw new Error(`Task ${id} is terminal`);
    if (task.revision === Number.MAX_SAFE_INTEGER)
        throw new Error('Task revision exhausted');
    return task;
}
export function dependenciesComplete(state, task) {
    for (const id of task.dependsOn) {
        if (state.tasks.find(candidate => candidate.id === id)?.status !== 'complete')
            throw new Error(`Dependency ${id} is not complete`);
    }
}
export function prepareCompletion(state, input) {
    const task = checkedTask(state, input);
    dependenciesComplete(state, task);
    if (task.status !== 'running')
        throw new Error('Start the task before completing it');
    const evidence = [...new Set([...task.evidence, ...strings(input.evidence, 'completion evidence')])];
    const remaining = input.remaining === undefined ? task.remaining : strings(input.remaining, 'remaining');
    if (!evidence.length || remaining.length)
        throw new Error('Completion requires evidence and no remaining work');
    return { ...task, status: 'complete', revision: task.revision + 1, evidence, remaining };
}
export function taskAction(state, input) {
    validateState(state);
    object(input, 'task action');
    const draft = structuredClone(state);
    const action = text(input.action, 'action');
    if (action === 'add') {
        const id = text(input.id, 'task id');
        if (draft.tasks.some(task => task.id === id))
            throw new Error(`Task already exists: ${id}`);
        const task = {
            id, title: text(input.title, 'title'), owner: owner(draft, input.owner),
            harness: harness(input.harness ?? draft.team.harness), status: 'pending', revision: 0,
            dependsOn: strings(input.dependsOn ?? [], 'dependsOn'),
            evidence: strings(input.evidence ?? [], 'evidence'), remaining: strings(input.remaining ?? [], 'remaining'),
        };
        if (input.kbd !== undefined)
            task.kbd = structuredClone(object(input.kbd, 'kbd'));
        if (input.modelPolicy !== undefined)
            task.modelPolicy = structuredClone(object(input.modelPolicy, 'modelPolicy'));
        draft.tasks.push(task);
        recordEvent(draft, 'task.added', { taskId: id, owner: task.owner, harness: task.harness, taskRevision: 0 });
    }
    else {
        const task = checkedTask(draft, input);
        const previousOwner = task.owner;
        const previousHarness = task.harness;
        const previousStatus = task.status;
        const previousRevision = task.revision;
        if (action === 'complete') {
            if (task.kbd)
                throw new Error('KBD-linked completion requires completeKbdTask and a successful canonical CLI receipt');
            Object.assign(task, prepareCompletion(draft, input));
        }
        else {
            switch (action) {
                case 'start':
                    if (!['pending', 'blocked'].includes(task.status))
                        throw new Error('Only pending or blocked tasks can start');
                    dependenciesComplete(draft, task);
                    task.status = 'running';
                    break;
                case 'block': {
                    if (!['pending', 'running'].includes(task.status))
                        throw new Error('Only pending or running tasks can be blocked');
                    const reason = text(input.reason, 'block reason');
                    task.remaining = [...new Set([...task.remaining, reason])];
                    task.status = 'blocked';
                    break;
                }
                case 'cancel':
                    text(input.reason, 'cancellation reason');
                    task.status = 'cancelled';
                    break;
                case 'reassign':
                    task.owner = owner(draft, input.toOwner);
                    task.harness = harness(input.toHarness ?? task.harness);
                    if (task.owner === previousOwner && task.harness === previousHarness)
                        throw new Error('Reassignment must change owner or harness');
                    if (task.status === 'running')
                        task.status = 'pending';
                    break;
                default: throw new Error(`Unsupported task action: ${action}`);
            }
            if (input.evidence !== undefined)
                task.evidence = [...new Set([...task.evidence, ...strings(input.evidence, 'evidence')])];
            if (input.remaining !== undefined) {
                task.remaining = strings(input.remaining, 'remaining');
                if (action === 'block')
                    task.remaining = [...new Set([...task.remaining, text(input.reason, 'block reason')])];
            }
            task.revision++;
        }
        recordEvent(draft, `task.${action}`, {
            taskId: task.id, previousRevision, taskRevision: task.revision,
            previousOwner, previousHarness, previousStatus, owner: task.owner, harness: task.harness,
            status: task.status, evidence: task.evidence, remaining: task.remaining,
            ...(input.reason === undefined ? {} : { reason: text(input.reason, 'reason') }),
        });
    }
    validateState(draft);
    Object.assign(state, draft);
}

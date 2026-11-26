import type { ToolSpec } from './facts'
import { ASK_USER_TOOL_NAME } from './interaction/askUser'
import { SUBAGENT_TOOL_NAME } from './subagents/subagentText'

const text = (description: string) => ({ type: 'string', description })
const number = (description: string) => ({ type: 'number', description })
const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    objective: text('The concrete completion objective from the direct human request.'),
    max_goal_rounds: number('Round cap for this goal; omit for the default.'),
    budget_tokens: number('Token budget for this goal; omit for none.'),
    budget_usd: number('Cost budget in USD for this goal; omit for none.')
  },
  required: ['objective']
}
const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    goal_id: text('Exact id from a prior get_goal.'),
    revision: number('Exact revision from a prior get_goal.'),
    action: {
      type: 'string',
      enum: ['edit', 'pause', 'resume', 'complete', 'blocked'],
      description:
        'edit | pause | resume | complete | blocked. complete only when the objective is achieved; blocked only after the same condition persisted for the configured consecutive rounds.'
    },
    objective: text('Replacement objective; valid only with action edit.'),
    max_goal_rounds: number('New round cap; valid only with action edit.'),
    budget_tokens: number('New token budget; valid only with action edit.'),
    budget_usd: number('New USD budget; valid only with action edit.'),
    blocked_reason: text('The concrete blocking condition; required with action blocked.'),
    evidence: text('What proves each deliverable is done; required with action complete.')
  },
  required: ['goal_id', 'revision', 'action']
}
const GOAL_TOOL = { replay: 'safe', executionMode: 'sequential', availability: 'all', modelOnly: true } as const

export const goalToolSpecs = [
  {
    ...GOAL_TOOL,
    name: 'get_goal',
    description:
      'Read the current goal, or { goal: null } when none is set. Call it before update_goal and copy its id and revision.',
    schema: { type: 'object', properties: {} }
  },
  {
    ...GOAL_TOOL,
    name: 'create_goal',
    description:
      'Create a persisted goal that keeps this session working across automatic rounds. Only for a long-running objective the user asked for directly; not for single-turn work.',
    schema: CREATE_SCHEMA
  },
  {
    ...GOAL_TOOL,
    name: 'update_goal',
    description: 'Edit, pause, resume, complete or block the current goal. Copy goal_id and revision from get_goal.',
    schema: UPDATE_SCHEMA
  }
] as const satisfies readonly ToolSpec[]

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.',
  '- Run it in the foreground when you need its result to go on. Use background: true only when you have independent work to do meanwhile; you are notified when it finishes.'
].join('\n')
const ID = { type: 'string', description: 'The id a subagent result or notification gave.' }
const SPAWN_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'A short (3-5 word) title of the task, shown to the user.' },
    prompt: { type: 'string', description: 'The task for the subagent.' },
    fork: {
      type: 'boolean',
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    },
    background: {
      type: 'boolean',
      description:
        'Return at once and let the subagent work in the background; you are notified when it finishes. Default false.'
    },
    model: {
      type: 'string',
      description:
        'Only when the user (or the agent instructions) names a model for this task: the name as they said it, with the provider if they gave one, e.g. "OpenRouter Claude Sonnet 4.5". Leave it out otherwise.'
    }
  },
  required: ['description', 'prompt']
}
const MESSAGE_SCHEMA = {
  type: 'object',
  properties: { id: ID, message: { type: 'string', description: 'What to tell the subagent.' } },
  required: ['id', 'message']
}
// Subagents cannot start or manage subagents: a child conversation never gets these tools.
const SUBAGENT_TOOL = {
  replay: 'safe',
  executionMode: 'parallel',
  availability: 'parent-only',
  modelOnly: true
} as const

export const subagentToolSpecs = [
  {
    ...SUBAGENT_TOOL,
    name: SUBAGENT_TOOL_NAME,
    description: DESCRIPTION,
    schema: SPAWN_SCHEMA
  },
  {
    ...SUBAGENT_TOOL,
    name: 'message_subagent',
    description:
      'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step. A finished subagent continues in the background with the same id and history; you are notified when it finishes.',
    schema: MESSAGE_SCHEMA
  },
  {
    ...SUBAGENT_TOOL,
    name: 'stop_subagent',
    replay: 'unsafe',
    description:
      'Stop a running subagent by its id and get its partial output. You get no notification for it afterwards; message_subagent can continue it later.',
    schema: { type: 'object', properties: { id: ID }, required: ['id'] }
  }
] as const satisfies readonly ToolSpec[]

const ASK_DESCRIPTION = [
  'Ask the user one to four multiple-choice questions and wait for the answers. Use it to gather preferences or',
  'requirements, clarify ambiguous instructions, or get a decision between approaches while you work.',
  '- The user can always type their own answer, so do not add an "Other" option.',
  '- Set multiSelect to true to allow several answers to one question.',
  '- If you recommend an option, list it first and add "(Recommended)" to its label.'
].join('\n')
const OPTION_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'The text the user selects: concise, 1-5 words.' },
    description: { type: 'string', description: 'What this option means or what happens if it is chosen.' },
    preview: {
      type: 'string',
      description: 'Content shown while the option is focused, e.g. a mockup or code snippet.'
    }
  },
  required: ['label', 'description']
}
const ASK_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      description: 'Questions to ask the user (1-4).',
      items: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description:
              'The complete question, clear and specific, ending with a question mark. If multiSelect is true, phrase it accordingly.'
          },
          header: {
            type: 'string',
            description: 'Very short label displayed as a chip (max 12 chars), e.g. "Auth method", "Library".'
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            description: '2-4 distinct choices, mutually exclusive unless multiSelect is set.',
            items: OPTION_SCHEMA
          },
          multiSelect: { type: 'boolean', description: 'Allow the user to select several options. Default false.' }
        },
        required: ['question', 'header', 'options']
      }
    }
  },
  required: ['questions']
}
const TODO_DESCRIPTION =
  'Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. ' +
  'Add one todo per concrete step before you start. While work remains, keep exactly one todo `in_progress`. ' +
  'Mark each todo `completed` as soon as it is done.'
const TODO_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      description: 'The COMPLETE task list, replacing any previous list.',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What the task is — a short imperative line.' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
            description: 'pending (not started) | in_progress (now) | completed (done).'
          }
        },
        required: ['content', 'status'],
        additionalProperties: false
      }
    }
  },
  required: ['todos'],
  additionalProperties: false
}

export const interactionToolSpecs = [
  {
    name: ASK_USER_TOOL_NAME,
    description: ASK_DESCRIPTION,
    schema: ASK_SCHEMA,
    replay: 'safe',
    executionMode: 'sequential',
    availability: 'all',
    modelOnly: true
  },
  {
    name: 'todo_write',
    description: TODO_DESCRIPTION,
    schema: TODO_SCHEMA,
    replay: 'safe',
    executionMode: 'parallel',
    availability: 'all',
    modelOnly: true
  }
] as const satisfies readonly ToolSpec[]

const RECALL_DESCRIPTION = [
  'Recall earlier parts of this session, including anything dropped by compaction.',
  'Use it before saying the context is gone.',
  '',
  'Pick one per call:',
  '- query: keyword search; entries matching more of the words come first, 5 per page.',
  '- range: [from, to]: entries #from..#to in order, 20 per page.',
  '- expand: [N, ...]: full untruncated text of those entries.',
  'With no argument, the latest entries are listed.',
  '',
  '#N is the entry number shown in recall results. Only the current session is searchable.'
].join('\n')
const RECALL_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: "What to recall, in plain keywords (e.g. 'redis cache decision')." },
    range: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
      description: '[from, to]: every entry from #from to #to (inclusive) in order, 20 per page.'
    },
    expand: {
      type: 'array',
      items: { type: 'number' },
      description: '#N indices to return full untruncated content for.'
    },
    page: { type: 'number', description: 'Page number (1-based) for query or range results. Default: 1.' },
    scope: {
      type: 'string',
      enum: ['lineage', 'all'],
      description: 'Both cover the current conversation; edited-away turns are not kept.'
    },
    mode: { type: 'string', enum: ['hybrid', 'touched'], description: "Only 'hybrid' (default) is supported." }
  }
}

export const recallToolSpec = {
  name: 'vcc_recall',
  description: RECALL_DESCRIPTION,
  schema: RECALL_SCHEMA,
  replay: 'safe',
  executionMode: 'parallel',
  availability: 'all',
  modelOnly: true
} as const satisfies ToolSpec

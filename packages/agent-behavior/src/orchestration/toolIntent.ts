/** The argument a model fills in on every tool call: why it is making that call. */
export const TOOL_INTENT_ARG = 'intent'

/**
 * The convention, said once in the system prompt. The per-tool property stays a few words because it is repeated for
 * every tool in every request.
 */
export const TOOL_INTENT_GUIDE = [
  'Every tool call takes an `intent` argument: one short sentence saying WHY you are making this call, written in the',
  'language the user is speaking. It is shown to the user as the line above the call, so state a purpose they would',
  'recognise ("find where the API key is loaded"), not the mechanics ("read a file", "run ls"). Fill it in on every',
  'call. Do not repeat it in prose right before or after the call; keep prose for findings, outcomes, blockers and',
  'decisions. When retrying, say what changed instead of repeating the goal.'
].join(' ')

/**
 * Whether a model is offered `intent`. DeepSeek models call tool after tool without saying what they are doing, so their
 * steps would read as a bare list of commands; other models already narrate between calls.
 */
export function offersToolIntent(modelId: string | undefined): boolean {
  return modelId !== undefined && /deepseek/i.test(modelId)
}

const INTENT_PROPERTY = { type: 'string', description: 'Purpose of this call.' }

/** The tool fields the transform reads and replaces; Pi and Pi Durable tools both carry them. */
export interface IntentTool {
  readonly parameters: unknown
  readonly prepareArguments?: (args: never) => unknown
}

type Schema = Record<string, unknown>

const isRecord = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The schema's properties when it could take `intent`, or `undefined` when it cannot or must not. */
function intentFreeProperties(parameters: unknown): Schema | undefined {
  if (!isRecord(parameters) || parameters.type !== 'object') return undefined
  const properties = parameters.properties ?? {}
  // A tool that already declares the name owns its meaning, and its calls must keep the argument.
  if (!isRecord(properties) || TOOL_INTENT_ARG in properties) return undefined
  return properties
}

/** `args` without `intent`; the same object when it has none, and never a mutation of the caller's object. */
export function withoutToolIntent(args: unknown): unknown {
  if (!isRecord(args) || !(TOOL_INTENT_ARG in args)) return args
  const rest = { ...args }
  delete rest[TOOL_INTENT_ARG]
  return rest
}

/**
 * A transform that removes `intent` from each call before anything else reads it: the tool's own argument repair,
 * schema validation, gates and execution all see the arguments without it. The model's call keeps it, which is what
 * the transcript records and the UI shows. With `offer`, the tool's schema also gains the optional argument; without
 * it, the schema is unchanged and a call that still carries `intent` (for example after switching away from a model
 * that was offered it) runs as if it had none. A tool whose schema could not take `intent` is returned unchanged. The
 * transform returns one wrapper per tool and `offer`, so repeated loadouts keep the schema object validators are
 * cached by.
 */
export function createToolIntent(): <T extends IntentTool>(tool: T, offer: boolean) => T {
  const offered = new WeakMap<object, object>()
  const stripped = new WeakMap<object, object>()
  return <T extends IntentTool>(tool: T, offer: boolean): T => {
    const wrapped = offer ? offered : stripped
    const known = wrapped.get(tool)
    if (known) return known as T
    const properties = intentFreeProperties(tool.parameters)
    if (!properties) return tool
    const prepare = tool.prepareArguments as ((args: unknown) => unknown) | undefined
    const result = {
      ...tool,
      ...(offer && {
        parameters: {
          ...(tool.parameters as Schema),
          properties: { ...properties, [TOOL_INTENT_ARG]: INTENT_PROPERTY }
        }
      }),
      prepareArguments: (args: unknown) => (prepare ? prepare(withoutToolIntent(args)) : withoutToolIntent(args))
    }
    wrapped.set(tool, result)
    return result
  }
}

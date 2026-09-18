/**
 * Convert a ComfyUI workflow saved in UI format into the API-format prompt that
 * `POST /prompt` accepts.
 *
 * The two shapes differ: a saved workflow is `{ nodes, links, definitions }`
 * with subgraph instances, while a prompt is `{ [nodeId]: { class_type, inputs } }`.
 * The frontend normally performs this conversion in the browser; a server does
 * not expose it, so we reimplement it here.
 *
 * Rules, each verified against a live ComfyUI server:
 *  - A node whose `type` is a subgraph id is expanded recursively.
 *  - Inside a scope, an input's `link` resolves against that scope's links.
 *    A link originating at the scope's input node is a promoted input, filled
 *    from the instance.
 *  - A subgraph instance's outputs point at the inner node producing them.
 *  - Bypassed nodes (mode 4) are not executed: consumers see their input instead.
 *  - Widget values are positional over the *backend's* widget declaration order,
 *    which is neither the UI `inputs[]` order nor freed by a link override.
 */

type JsonObject = Record<string, unknown>

export interface UiNode {
  id: number
  type: string
  mode?: number
  title?: string
  inputs?: Array<{ name: string; type?: string; link?: number | null; widget?: { name: string } }>
  outputs?: Array<{ name: string; type?: string; links?: number[] | null }>
  widgets_values?: unknown[] | JsonObject
}

export interface UiLink {
  id: number
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
}

interface UiGraph {
  nodes: UiNode[]
  links?: Array<UiLink | number[]>
}

interface UiSubgraph extends UiGraph {
  id: string
  name?: string
  inputs?: Array<{ name: string; linkIds?: number[] }>
  outputs?: Array<{ name: string; linkIds?: number[] }>
  inputNode?: { id: number }
  outputNode?: { id: number }
}

interface UiWorkflow extends UiGraph {
  definitions?: { subgraphs?: UiSubgraph[] }
}

/** Node classes the backend can execute, keyed by class name. */
export type ObjectInfo = Record<string, { input?: { required?: JsonObject; optional?: JsonObject } }>

export interface ApiPromptNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta: { title: string }
}

export interface ConversionResult {
  prompt: Record<string, ApiPromptNode>
  warnings: string[]
}

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])
const CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize'])

/** Frontend classes with no backend node: the prompt cannot contain them, so
 * their outputs pass through to their input like the frontend's graphToPrompt. */
const FRONTEND_ONLY_CLASSES = new Set(['Reroute', 'Note', 'MarkdownNote'])

export type Reference = [string, number]

/** One hop of an alias resolution: the producer to keep following, or a final value. */
interface AliasStep {
  ref?: Reference
  value?: unknown
  type?: string
}

/** Backend widget inputs for a node class, in declaration order. */
function widgetInputNames(info: ObjectInfo[string], includeAdvanced = false): string[] {
  const names: string[] = []
  for (const section of ['required', 'optional'] as const) {
    const spec = info.input?.[section]
    if (!spec) continue
    for (const [name, raw] of Object.entries(spec)) {
      const entry = raw as unknown[]
      if (!Array.isArray(entry) || entry.length === 0) continue
      const type = entry[0]
      const config = (entry.length > 1 && typeof entry[1] === 'object' ? entry[1] : {}) as JsonObject
      if (config.advanced && !includeAdvanced) continue
      if (Array.isArray(type) || WIDGET_TYPES.has(type as string)) names.push(name)
    }
  }
  return names
}

export const isReference = (value: unknown): value is Reference =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'

/**
 * The ComfyUI frontend's `isValidConnection`: a wildcard or empty type matches
 * anything, comma-separated unions match on any member, otherwise it is a
 * case-insensitive exact type match.
 */
function isValidConnection(typeA?: string, typeB?: string): boolean {
  const a = (typeA ?? '').toLowerCase()
  const b = (typeB ?? '').toLowerCase()
  if (a === '' || a === '*' || b === '' || b === '*') return true
  if (!a.includes(',') && !b.includes(',')) return a === b
  return a.split(',').some((x) => b.split(',').some((y) => isValidConnection(x, y)))
}

/**
 * Which of the bypass node's inputs feeds output `slot`, mirroring the
 * frontend's `_getBypassSlotIndex`: the same-numbered input while the
 * positional types are compatible with both the output and the type the
 * eventual consumer asks for, else the first exact then compatible match.
 * Returns -1 when no input can satisfy them.
 */
function bypassInputSlot(node: UiNode, slot: number, requestedType?: string): number {
  const inputs = node.inputs ?? []
  const outputType = node.outputs?.[slot]?.type
  const type = requestedType ?? outputType
  if (type == null || type === '*' || type === '') return inputs.length > slot ? slot : 0
  const opposite = inputs[slot]
  if (opposite && isValidConnection(opposite.type, outputType) && isValidConnection(opposite.type, type)) return slot
  const exact = inputs.findIndex((input) => input.type === type)
  if (exact !== -1) return exact
  return inputs.findIndex((input) => isValidConnection(input.type, outputType) && isValidConnection(input.type, type))
}

/**
 * In the API format an array is reserved for node connections (`[nodeId, slot]`),
 * so a widget value that is itself an array is wrapped in an object the backend
 * unwraps during execution. Matches the ComfyUI frontend's `graphToPrompt`.
 */
function wrapWidgetValue(value: unknown): unknown {
  return Array.isArray(value) ? { __value__: value } : value
}

export function convertUiWorkflowToPrompt(ui: UiWorkflow, objectInfo: ObjectInfo): ConversionResult {
  const subgraphs = new Map((ui.definitions?.subgraphs ?? []).map((sub) => [sub.id, sub]))
  const prompt: Record<string, ApiPromptNode> = {}
  const warnings: string[] = []
  /**
   * Node ids the prompt cannot contain (subgraph instances, bypassed and
   * frontend-only classes) map each output slot to a resolver. Called with the
   * type the consuming input declares (mirroring the frontend's
   * `_getBypassSlotIndex`, whose type propagates down a bypass chain), it
   * returns the next hop — a real producer reference, a resolved value, or
   * undefined when nothing fits.
   */
  const aliases: Record<string, Record<number, (type?: string) => AliasStep | undefined>> = {}
  let nextId = 1

  const linkMap = (links: UiGraph['links']) => {
    const map = new Map<number, UiLink>()
    for (const link of links ?? []) {
      if (Array.isArray(link)) {
        map.set(link[0], {
          id: link[0],
          origin_id: link[1],
          origin_slot: link[2],
          target_id: link[3],
          target_slot: link[4]
        })
      } else {
        map.set(link.id, link)
      }
    }
    return map
  }

  function resolveLink(
    linkId: number,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ): unknown {
    const link = links.get(linkId)
    if (!link) {
      warnings.push(`dangling link ${linkId}`)
      return undefined
    }
    const promoted = bindings.get(link.origin_id)
    if (promoted) return promoted.get(link.origin_slot)
    const target = remap.get(link.origin_id)
    if (target === undefined) {
      warnings.push(`link ${linkId} points outside its scope (origin ${link.origin_id})`)
      return undefined
    }
    return [String(target), link.origin_slot] satisfies Reference
  }

  /** The declared type of a prompt node's input, for bypass slot selection. */
  function consumerInputType(node: ApiPromptNode, name: string): string | undefined {
    const spec = objectInfo[node.class_type]?.input
    const entry = (spec?.required?.[name] ?? spec?.optional?.[name]) as unknown[] | undefined
    const type = Array.isArray(entry) ? entry[0] : undefined
    return Array.isArray(type) ? type.join(',') : typeof type === 'string' ? type : undefined
  }

  /** Positional widget values, aligned to the backend's declaration order. */
  function widgetValues(node: UiNode, linked: Set<string>): Record<string, unknown> {
    const raw = node.widgets_values
    const info = objectInfo[node.type]
    if (!info || !Array.isArray(raw)) return {}
    let values = raw
    const baseNames = widgetInputNames(info)
    const widerNames = widgetInputNames(info, true)
    // A trailing control_after_generate pseudo-widget pads the saved values.
    // Drop it only when the remainder lines up with a widget count — a
    // legitimate widget value that happens to read 'fixed' must not be
    // removed, which would shift every later value.
    if (values.length !== baseNames.length && values.length !== widerNames.length) {
      const filtered = values.filter((v) => !(typeof v === 'string' && CONTROL_VALUES.has(v)))
      if (filtered.length === baseNames.length || filtered.length === widerNames.length) values = filtered
    }
    const names = values.length === widerNames.length ? widerNames : baseNames
    const out: Record<string, unknown> = {}
    names.forEach((name, index) => {
      if (index < values.length && !linked.has(name)) out[name] = wrapWidgetValue(values[index])
    })
    if (values.length !== names.length) {
      warnings.push(`${node.type}: ${values.length} widget values for ${names.length} widgets`)
    }
    return out
  }

  /**
   * A node the prompt cannot contain (bypassed, or a frontend-only class) can
   * still feed consumers: the frontend passes each output through to the input
   * that can produce the type the consumer asks for (see `bypassInputSlot`),
   * so alias the output to a resolver over that input's link.
   */
  function passThrough(
    node: UiNode,
    kind: string,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(node.id)!
    const alias: Record<number, (type?: string) => AliasStep | undefined> = {}
    ;(node.outputs ?? []).forEach((output, slot) => {
      const defaultSlot = bypassInputSlot(node, slot, output.type)
      const defaultLink = defaultSlot >= 0 ? (node.inputs?.[defaultSlot]?.link ?? null) : null
      if (defaultLink != null) {
        alias[slot] = (type) => {
          const inputSlot = bypassInputSlot(node, slot, type)
          const link = inputSlot >= 0 ? (node.inputs?.[inputSlot]?.link ?? null) : null
          if (link == null) return undefined
          const resolved = resolveLink(link, links, remap, bindings)
          if (resolved === undefined) return undefined
          return isReference(resolved) ? { ref: resolved, type: node.inputs?.[inputSlot]?.type } : { value: resolved }
        }
      } else if ((output.links ?? []).length > 0) {
        warnings.push(`${kind} ${node.type} output ${slot} has no input to pass through`)
      }
    })
    aliases[String(id)] = alias
  }

  function emit(
    node: UiNode,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(node.id)!
    // Frontend-only classes (MarkdownNote, Note, Reroute, ...) have no backend
    // node and make the whole prompt fail validation. A consumer of one still
    // has to resolve, so pass its outputs through like the frontend does for
    // Reroute; note-like classes without outgoing links vanish entirely.
    // A class that is not in object_info but is not frontend-only is emitted
    // as-is — an executable custom node missing from a stale snapshot still
    // runs, and one the server does not know fails its own validation naming
    // the class, instead of being silently rewired.
    if (!objectInfo[node.type]) {
      if (!FRONTEND_ONLY_CLASSES.has(node.type)) {
        warnings.push(`${node.type} is not in object_info; submitting it as-is for the server to validate`)
      } else {
        passThrough(node, 'frontend-only', links, remap, bindings)
        return
      }
    }
    const linked = new Set((node.inputs ?? []).filter((slot) => slot.link != null).map((slot) => slot.name))
    const inputs: Record<string, unknown> = {}
    for (const slot of node.inputs ?? []) {
      if (slot.link != null) inputs[slot.name] = resolveLink(slot.link, links, remap, bindings)
    }
    Object.assign(inputs, widgetValues(node, linked))
    prompt[String(id)] = {
      class_type: node.type,
      inputs,
      _meta: { title: node.title || node.type }
    }
  }

  function expand(
    instance: UiNode,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(instance.id)!
    const definition = subgraphs.get(instance.type)!
    const innerRemap = new Map<number, number>()
    for (const node of definition.nodes) innerRemap.set(node.id, nextId++)
    const innerLinks = linkMap(definition.links)
    const inputNodeId = definition.inputNode?.id

    // Bind the definition's promoted inputs from the instance. Only inputs
    // carrying a widget consume a positional `widgets_values` entry.
    const innerBindings = new Map<number, Map<number, unknown>>()
    if (inputNodeId !== undefined) {
      const values = instance.widgets_values
      const byName = new Map<string, unknown>()
      let widgetIndex = 0
      for (const slot of instance.inputs ?? []) {
        if (slot.link != null) {
          byName.set(slot.name, resolveLink(slot.link, links, remap, bindings))
        } else if ('widget' in slot) {
          byName.set(slot.name, wrapWidgetValue(Array.isArray(values) ? values[widgetIndex] : values?.[slot.name]))
          widgetIndex += 1
        }
      }
      const bySlot = new Map<number, unknown>()
      ;(definition.inputs ?? []).forEach((def, index) => {
        if (!byName.has(def.name)) {
          warnings.push(`instance ${instance.id} has no value for promoted input ${def.name}`)
        }
        bySlot.set(index, byName.get(def.name))
      })
      innerBindings.set(inputNodeId, bySlot)
    }

    // Publish the definition's outputs under the instance id so outer nodes can
    // be rewritten to the inner producer.
    const outputNodeId = definition.outputNode?.id
    const alias: Record<number, (type?: string) => AliasStep | undefined> = {}
    ;(definition.outputs ?? []).forEach((def, slot) => {
      for (const linkId of def.linkIds ?? []) {
        const link = innerLinks.get(linkId)
        if (!link) continue
        if (outputNodeId !== undefined && link.target_id !== outputNodeId) {
          warnings.push(`subgraph output link ${linkId} does not end at the output node`)
          continue
        }
        const origin = innerRemap.get(link.origin_id)
        if (origin !== undefined) alias[slot] = () => ({ ref: [String(origin), link.origin_slot] })
        break
      }
    })
    aliases[String(id)] = alias

    for (const node of definition.nodes) walk(node, innerLinks, innerRemap, innerBindings)
  }

  function walk(
    node: UiNode,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    if (node.mode === 2) return // muted: never runs; consumers of it are dropped below
    if (node.mode === 4) {
      // Bypassed: consumers see this node's input instead.
      passThrough(node, 'bypassed', links, remap, bindings)
      return
    }
    if (subgraphs.has(node.type)) expand(node, links, remap, bindings)
    else emit(node, links, remap, bindings)
  }

  const rootRemap = new Map<number, number>()
  for (const node of ui.nodes ?? []) rootRemap.set(node.id, nextId++)
  const rootLinks = linkMap(ui.links)
  for (const node of ui.nodes ?? []) walk(node, rootLinks, rootRemap, new Map())

  // Aliases resolve to a fixed point: a holder's target may itself be another
  // alias holder (a bypass fed by a bypass), so follow the chain until a real
  // producer or value shows up, carrying the consumer's type through the way
  // the frontend does (the chosen input's own type seeds the next hop).
  const resolveAlias = (ref: Reference, type: string | undefined): unknown => {
    const seen = new Set<string>()
    let current = { ref, type }
    while (true) {
      if (seen.has(current.ref[0])) {
        warnings.push(`circular pass-through at ${current.ref[0]}`)
        return undefined
      }
      seen.add(current.ref[0])
      const holder = aliases[current.ref[0]]?.[current.ref[1]]
      if (!holder) return current.ref
      const step = holder(current.type)
      if (step === undefined) return undefined
      if (step.ref === undefined) return step.value
      current = { ref: step.ref, type: step.type }
    }
  }

  const settlePasses = Object.keys(aliases).length + 1
  for (let pass = 0; pass < settlePasses; pass += 1) {
    let changed = false
    for (const node of Object.values(prompt)) {
      for (const [name, value] of Object.entries(node.inputs)) {
        if (!isReference(value)) continue
        if (!aliases[value[0]]) continue
        const resolved = resolveAlias(value, consumerInputType(node, name))
        if (resolved === undefined) {
          warnings.push(`alias ${value[0]} output slot ${value[1]} unresolved`)
          continue
        }
        node.inputs[name] = resolved
        changed = true
      }
    }
    if (!changed) break
  }

  // The frontend drops consumer inputs that still reference a node the prompt
  // does not contain (muted, or a pass-through with no input to pass), so the
  // server never sees a node id it cannot resolve.
  for (const node of Object.values(prompt)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (!isReference(value) || prompt[value[0]]) continue
      warnings.push(`dropped input ${name} of ${node.class_type} (node ${value[0]} is not in the prompt)`)
      delete node.inputs[name]
    }
  }

  return { prompt, warnings }
}

/**
 * Prompt input names by preference; the SDXL, Flux, and SD3 text encodes split
 * their prompt across named streams, and Lumina2 names its own. The first
 * recognized stream receives the chat prompt, the workflow-authored values of
 * the others are preserved.
 */
const PROMPT_INPUT_PREFERENCE = ['text', 'prompt', 'text_g', 't5xxl', 'clip_g', 'clip_l', 'text_l', 'user_prompt']

/**
 * The node that should receive the user's prompt. A positive and a negative
 * conditioning node both hold a `text` input, so pick the one the sampler
 * actually consumes as its positive conditioning. That node may chain the
 * conditioning through combiners before a text encode shows up, so follow
 * references breadth-first until one carries the prompt as a string. The
 * sampler is reported with it so a per-run seed can be written where that
 * graph reads its own.
 */
export function findPromptTarget(
  prompt: Record<string, ApiPromptNode>
): { nodeId: string; input: string; samplerId: string } | undefined {
  for (const [samplerId, node] of Object.entries(prompt)) {
    const positive = node.inputs.positive
    if (!isReference(positive)) continue
    const queue = [positive[0]]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      const target = prompt[nodeId]
      if (!target) continue
      let best: { name: string; rank: number } | undefined
      for (const [name, value] of Object.entries(target.inputs)) {
        if (typeof value !== 'string') continue
        const rank = PROMPT_INPUT_PREFERENCE.indexOf(name)
        if (rank !== -1 && (best === undefined || rank < best.rank)) best = { name, rank }
      }
      if (best) return { nodeId, input: best.name, samplerId }
      for (const value of Object.values(target.inputs)) {
        if (isReference(value)) queue.push(value[0])
      }
    }
  }
  return undefined
}

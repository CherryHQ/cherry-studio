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

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN'])
const CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize'])

export type Reference = [string, number]

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
 * positional types are compatible, else the first exact then compatible
 * type match. Returns -1 when no input can produce the output's type.
 */
function bypassInputSlot(node: UiNode, slot: number): number {
  const inputs = node.inputs ?? []
  const outputType = node.outputs?.[slot]?.type
  if (outputType == null) return slot
  if (outputType === '*' || outputType === '') return inputs.length > slot ? slot : 0
  const opposite = inputs[slot]
  if (opposite && isValidConnection(opposite.type, outputType)) return slot
  const exact = inputs.findIndex((input) => input.type === outputType)
  if (exact !== -1) return exact
  return inputs.findIndex((input) => isValidConnection(input.type, outputType))
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
  /** Instance node id -> its output slot's real producer, or a bypassed node's input. */
  const aliases: Record<string, Record<number, unknown>> = {}
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

  /** Positional widget values, aligned to the backend's declaration order. */
  function widgetValues(node: UiNode, linked: Set<string>): Record<string, unknown> {
    const raw = node.widgets_values
    const info = objectInfo[node.type]
    if (!info || !Array.isArray(raw)) return {}
    let values = raw
    if (values.length > widgetInputNames(info).length) {
      const filtered = values.filter((v) => !(typeof v === 'string' && CONTROL_VALUES.has(v)))
      if (filtered.length !== values.length) values = filtered
    }
    let names = widgetInputNames(info)
    if (values.length !== names.length) {
      const wider = widgetInputNames(info, true)
      if (values.length === wider.length) names = wider
    }
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
   * that can produce its type (see `bypassInputSlot`), so alias the output to
   * that input's resolved link.
   */
  function passThrough(
    node: UiNode,
    kind: string,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(node.id)!
    const alias: Record<number, unknown> = {}
    ;(node.outputs ?? []).forEach((output, slot) => {
      const inputSlot = bypassInputSlot(node, slot)
      const link = inputSlot >= 0 ? node.inputs?.[inputSlot]?.link : undefined
      if (link != null) {
        const ref = resolveLink(link, links, remap, bindings)
        if (ref !== undefined) {
          alias[slot] = ref
          return
        }
      }
      if ((output.links ?? []).length > 0) {
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
    if (!objectInfo[node.type]) {
      passThrough(node, 'frontend-only', links, remap, bindings)
      return
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
    const alias: Record<number, unknown> = {}
    ;(definition.outputs ?? []).forEach((def, slot) => {
      for (const linkId of def.linkIds ?? []) {
        const link = innerLinks.get(linkId)
        if (!link) continue
        if (outputNodeId !== undefined && link.target_id !== outputNodeId) {
          warnings.push(`subgraph output link ${linkId} does not end at the output node`)
          continue
        }
        const origin = innerRemap.get(link.origin_id)
        if (origin !== undefined) alias[slot] = [String(origin), link.origin_slot]
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

  // Aliases can chain (a bypassed node fed by a subgraph), so settle iteratively.
  // Every pass resolves at least one hop of each remaining chain, so the number
  // of alias holders bounds the depth — a fixed point is always reached.
  const settlePasses = Object.keys(aliases).length + 1
  for (let pass = 0; pass < settlePasses; pass += 1) {
    let changed = false
    for (const node of Object.values(prompt)) {
      for (const [name, value] of Object.entries(node.inputs)) {
        if (!isReference(value)) continue
        const alias = aliases[value[0]]
        if (!alias) continue
        const target = alias[value[1]]
        if (target === undefined) {
          warnings.push(`alias ${value[0]} output slot ${value[1]} unresolved`)
          continue
        }
        node.inputs[name] = target
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

/** Input names that can carry the prompt; the SDXL text encodes split theirs. */
const PROMPT_INPUT_NAMES = new Set(['text', 'prompt', 'text_g', 'text_l'])

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
      const entry = Object.entries(target.inputs).find(
        ([name, value]) => typeof value === 'string' && PROMPT_INPUT_NAMES.has(name)
      )
      if (entry) return { nodeId, input: entry[0], samplerId }
      for (const value of Object.values(target.inputs)) {
        if (isReference(value)) queue.push(value[0])
      }
    }
  }
  return undefined
}

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
  inputs?: Array<{ name: string; link?: number | null; widget?: { name: string } }>
  outputs?: Array<{ name: string; links?: number[] | null }>
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

type Reference = [string, number]

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

const isReference = (value: unknown): value is Reference =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'

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
      if (index < values.length && !linked.has(name)) out[name] = values[index]
    })
    if (values.length !== names.length) {
      warnings.push(`${node.type}: ${values.length} widget values for ${names.length} widgets`)
    }
    return out
  }

  function emit(
    node: UiNode,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(node.id)!
    // Frontend-only classes (MarkdownNote, Note, Reroute, ...) have no backend
    // node and make the whole prompt fail validation.
    if (!objectInfo[node.type]) {
      if ((node.outputs ?? []).some((slot) => (slot.links ?? []).length > 0)) {
        warnings.push(`dropped frontend-only node ${node.type} with outgoing links`)
      }
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
          byName.set(slot.name, Array.isArray(values) ? values[widgetIndex] : values?.[slot.name])
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
    if (node.mode === 2) return // muted: never runs, nothing consumes its outputs
    if (node.mode === 4) {
      // Bypassed: consumers see this node's input instead.
      const id = remap.get(node.id)!
      const refs = (node.inputs ?? [])
        .filter((slot) => slot.link != null)
        .map((slot) => resolveLink(slot.link!, links, remap, bindings))
      const alias: Record<number, unknown> = {}
      ;(node.outputs ?? []).forEach((_, slot) => {
        if (slot < refs.length) alias[slot] = refs[slot]
        else warnings.push(`bypassed ${node.type} output ${slot} has no input to pass through`)
      })
      aliases[String(id)] = alias
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
  for (let pass = 0; pass < 8; pass += 1) {
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

  return { prompt, warnings }
}

/**
 * The node that should receive the user's prompt. A positive and a negative
 * conditioning node both hold a `text` input, so pick the one the sampler
 * actually consumes as its positive conditioning. The sampler is reported with it
 * so a per-run seed can be written where that graph reads its own.
 */
export function findPromptTarget(
  prompt: Record<string, ApiPromptNode>
): { nodeId: string; input: string; samplerId: string } | undefined {
  for (const [samplerId, node] of Object.entries(prompt)) {
    const positive = node.inputs.positive
    if (!isReference(positive)) continue
    const target = prompt[positive[0]]
    if (!target) continue
    const entry = Object.entries(target.inputs).find(
      ([name, value]) => typeof value === 'string' && (name === 'text' || name === 'prompt')
    )
    if (entry) return { nodeId: positive[0], input: entry[0], samplerId }
  }
  return undefined
}

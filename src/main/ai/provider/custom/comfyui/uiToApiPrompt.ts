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
  widgets_values_named?: JsonObject
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
  inputs?: Array<{ name: string; type?: string; linkIds?: number[] }>
  outputs?: Array<{ name: string; type?: string; linkIds?: number[] }>
  inputNode?: { id: number }
  outputNode?: { id: number }
}

interface UiWorkflow extends UiGraph {
  definitions?: { subgraphs?: UiSubgraph[] }
}

/** Node classes the backend can execute, keyed by class name. */
export type ObjectInfo = Record<
  string,
  {
    input?: { required?: JsonObject; optional?: JsonObject }
    /** The server's own declaration order per section. Object key order is not
     * a reliable substitute: integer-like keys iterate first, in numeric order. */
    input_order?: { required?: string[]; optional?: string[] }
    /** The server executes this class for its side effect, so a node of it is
     * where a run ends — the anchor the target walk falls back to. */
    output_node?: boolean
  }
>

export interface ApiPromptNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta: { title: string }
}

export interface ConversionResult {
  prompt: Record<string, ApiPromptNode>
  warnings: string[]
  /**
   * The text widgets the workflow itself exposes on a subgraph instance, in the
   * order a run should prefer them. A subgraph that promotes a STRING widget
   * shows it on the instance as the field the workflow is meant to be run with,
   * which is the one place a text input is unambiguous even when the graph
   * reaches the encoder through a concat that hides it.
   */
  promotedText: { nodeId: string; input: string }[]
}

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'])
/** Widget declarations with this config flag spend an extra positional value
 * for the control_after_generate pseudo-widget, which never reaches the prompt. */
const CONTROL_AFTER_GENERATE = 'control_after_generate'

/** Further frontend widget input types that spend a positional value: COLOR
 * holds a color string (or int), COLORS a list of color strings, RANGE a
 * `{min, max, midpoint?}` object. The frontend serializes them plainly in
 * graphToPrompt (arrays alone are wrapped), which wrapWidgetValue already does. */
const NON_SCALAR_WIDGET_TYPES = new Set(['COLOR', 'COLORS', 'RANGE'])

/** Frontend classes with no backend node: the prompt cannot contain them, so
 * their outputs pass through to their input like the frontend's graphToPrompt. */
const FRONTEND_ONLY_CLASSES = new Set(['Reroute', 'Note', 'MarkdownNote'])

/** The editor's value source: it carries a value, never a graph edge. */
const PRIMITIVE_NODE = 'PrimitiveNode'

export type Reference = [string, number]

/** One hop of an alias resolution: the producer to keep following, or a final
 * value. Tagged so the invalid state — both fields, or neither — cannot be
 * represented. */
type AliasStep = { kind: 'ref'; ref: Reference; type?: string } | { kind: 'value'; value: unknown }

interface WidgetNames {
  /** Every positional slot a widget declaration spends, in declaration order.
   * `null` marks the slot a `forceInput` input would have spent before
   * frontend 1.16 turned those into sockets — a workflow saved back then
   * still carries that dummy value, and the frontend's own `migrateWidgets
   * Values` drops it on load. */
  positions: (string | null)[]
  /** Widgets whose API value must carry the frontend's CURVE envelope. */
  curves: Set<string>
}

/** The widget names a node def's positions resolve to, dummies removed. */
const widgetNames = (acc: WidgetNames): string[] => acc.positions.filter((name): name is string => name !== null)

/** The widget implementation a declaration asks for: an explicit `widgetType`
 * (`"PAINTER"`, `"hidden"`, …) wins, otherwise the input type — `litegraph
 * Service.addInputSocket` looks the constructor up under exactly that key. */
const widgetTypeOf = (type: unknown, config: JsonObject): string =>
  (config.widgetType as string | undefined) ?? (Array.isArray(type) ? 'COMBO' : (type as string))

/** A declaration spends a positional slot when the frontend renders a widget
 * for it: a declared `widgetType` names the implementation to instantiate, so
 * an input whose own type is not a widget type still spends one. */
const spendsWidgetSlot = (widgetType: string, config: JsonObject, values?: unknown[]): boolean =>
  config.widgetType !== undefined ||
  WIDGET_TYPES.has(widgetType) ||
  NON_SCALAR_WIDGET_TYPES.has(widgetType) ||
  widgetType === 'CURVE' ||
  (widgetType === 'COMFY_DYNAMICCOMBO_V3' && values !== undefined)

/** Backend widget inputs for a node class, in declaration order. DynamicCombo
 * (v3) inputs expand into the combo value plus the selected option's child
 * inputs, dot-prefixed the way the frontend names them (`format.bit_depth`). */
function widgetInputNames(
  info: ObjectInfo[string],
  includeAdvanced = false,
  spec: JsonObject = info.input ?? {},
  prefix?: string,
  values?: unknown[],
  acc: WidgetNames = { positions: [], curves: new Set() },
  order: { required?: string[]; optional?: string[] } = info.input_order ?? {}
): WidgetNames {
  for (const section of ['required', 'optional'] as const) {
    const sectionSpec = spec[section] as JsonObject | undefined
    if (!sectionSpec) continue
    // The backend's declaration order is `input_order` when the server sends
    // it; iterating the object instead would move integer-like keys to the
    // front and shift every saved value after them onto the wrong input.
    const declared = order[section] ?? []
    const sectionNames = declared.length > 0 ? declared.filter((name) => name in sectionSpec) : Object.keys(sectionSpec)
    for (const name of sectionNames) {
      const raw = sectionSpec[name]
      const fullName = prefix ? `${prefix}.${name}` : name
      const entry = raw as unknown[]
      if (!Array.isArray(entry) || entry.length === 0) continue
      const type = entry[0]
      const config = (entry.length > 1 && typeof entry[1] === 'object' ? entry[1] : {}) as JsonObject
      if (config.advanced && !includeAdvanced) continue
      const widgetType = widgetTypeOf(type, config)
      const isWidget = spendsWidgetSlot(widgetType, config, values)
      if (config.forceInput) {
        // A socket, not a widget: no slot today, a legacy dummy one before 1.16.
        if (isWidget) acc.positions.push(null)
        continue
      }
      if (!isWidget) continue
      if (widgetType === 'CURVE') {
        acc.positions.push(fullName)
        acc.curves.add(fullName)
        continue
      }
      acc.positions.push(fullName)
      if (config[CONTROL_AFTER_GENERATE]) acc.positions.push(CONTROL_AFTER_GENERATE)
      if (widgetType === 'COMFY_DYNAMICCOMBO_V3') {
        const selected = values![acc.positions.length - 1]
        const option = (config.options as JsonObject[] | undefined)?.find((candidate) => candidate.key === selected)
        // A dynamic option's own inputs carry no order of their own, and the
        // node's `input_order` describes its top-level sections only.
        widgetInputNames(info, includeAdvanced, (option?.inputs ?? {}) as JsonObject, fullName, values, acc, {})
      }
    }
  }
  return acc
}

export const isReference = (value: unknown): value is Reference =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'

/**
 * A node that is its own value: every input it declares is either the `value`
 * widget or something the graph cannot reference. A text primitive is the
 * common case; a concat or a generator that takes other nodes as input is not
 * one, so its `value`-shaped input is never mistaken for the text.
 */
const isValueSource = (node: ApiPromptNode): boolean =>
  Object.entries(node.inputs).every(([name, value]) => name === 'value' || !isReference(value))

/**
 * A node that holds text and does not sample: a text primitive, or a text
 * encode whose prompt is still a workflow constant. It is the kind of node the
 * walk may stop at, and the kind an edgeless text source is not — a generator
 * with its own seed writes its prompt from its input rather than holding it.
 */
const holdsText = (node: ApiPromptNode): boolean =>
  typeof node.inputs.value === 'string' ||
  Object.entries(node.inputs).some(([name, value]) => typeof value === 'string' && isPromptShaped(name))

/** Whether a node samples on its own, rather than only carrying text. */
const isPlainTextNode = (node: ApiPromptNode): boolean =>
  seedInputKey(node.inputs) === undefined && !('latent_image' in node.inputs)

/** Required inputs the prompt must still carry when the workflow saved no
 * value for them: the frontend's widgets always hold something (the declared
 * default, a combo's first entry, or null), and ComfyUI rejects the whole
 * prompt when a required key is simply absent — the built-in `ImageCompare`
 * (`compare_view`, socketless) failed every Qwen-Image-Edit run that way. */
function requiredInputFallbacks(info: ObjectInfo[string], values?: unknown[]): Array<[string, unknown]> {
  const spec = info.input?.required
  if (!spec) return []
  const declared = info.input_order?.required ?? []
  const names = declared.length > 0 ? declared.filter((name) => name in spec) : Object.keys(spec)
  const out: Array<[string, unknown]> = []
  for (const name of names) {
    const entry = spec[name] as unknown[]
    if (!Array.isArray(entry) || entry.length === 0) continue
    const config = (entry.length > 1 && typeof entry[1] === 'object' ? entry[1] : {}) as JsonObject
    // A socket is satisfied by a link, never by a value, so only a declaration
    // the frontend renders as a widget (or marks `socketless`) can carry one:
    // `MODEL`, `LATENT`, `IMAGE` … cannot.
    const widgetType = widgetTypeOf(entry[0], config)
    if (config.forceInput) continue
    if ('default' in config) {
      // The frontend's widget carries the declared default from the start.
      if (spendsWidgetSlot(widgetType, config, values) || config.socketless === true) out.push([name, config.default])
      continue
    }
    // A combo the schema gives no default to still starts on its first entry in
    // the frontend, and the server requires the key. The options come either as
    // the declaration's own list or, on the newer `"COMBO"` form, from its
    // config — the cloud templates fail without one
    // (`GeminiNanoBanana2V2.response_modalities`, `KlingImageGenerationNode.
    // image_type`, `MeshyMultiImageToModelNode.symmetry_mode`).
    const options = Array.isArray(entry[0])
      ? entry[0]
      : Array.isArray(config.options)
        ? (config.options as unknown[])
        : undefined
    if (options !== undefined && options.length > 0 && widgetType !== 'COMFY_DYNAMICCOMBO_V3') {
      out.push([name, options[0]])
      continue
    }
    // `socketless` is a value with no socket, and a workflow stores nothing for
    // it: the frontend sends null, which the server accepts. Anything else stays
    // omitted — the workflow really is missing that value, and the server names
    // it (`MODEL`, `LATENT`, `IMAGE` … are sockets, satisfied by a link).
    if (config.socketless === true) out.push([name, null])
  }
  return out
}

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
  const promotedText: { nodeId: string; input: string }[] = []
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

  const namedValues = (values: JsonObject, linked: Set<string>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(values)) {
      if (!linked.has(name)) out[name] = wrapWidgetValue(value)
    }
    return out
  }

  /** Widget values, aligned to the backend's declaration order. */
  function widgetValues(node: UiNode, linked: Set<string>): Record<string, unknown> {
    const raw = node.widgets_values
    const info = objectInfo[node.type]
    if (!info) return {}
    let out: Record<string, unknown>
    let values: unknown[]
    // Named values (widgets_values_named, or the object form of widgets_values)
    // key straight to the inputs — a schema change cannot silently remap them
    // to a different position. A node the frontend has no widget for can still
    // carry an EMPTY map (the built-in `ImageCompare`), so both paths fall
    // through to the required-key pass below.
    if (Array.isArray(raw) && node.widgets_values_named) {
      out = namedValues(node.widgets_values_named, linked)
      values = raw
    } else if (raw !== undefined && !Array.isArray(raw)) {
      out = namedValues(raw, linked)
      values = []
    } else if (!Array.isArray(raw)) {
      out = {}
      values = []
    } else {
      const base = widgetInputNames(info, false, undefined, undefined, raw)
      let names = widgetNames(base)
      const curves = base.curves
      // A workflow saved before frontend 1.16 spends a dummy slot on every
      // `forceInput` input the frontend has since turned into a socket, so its
      // array only lines up once those dummies are dropped — exactly what the
      // frontend's own `migrateWidgetsValues` does on load.
      const aligned =
        base.positions.length === raw.length ? raw.filter((_, index) => base.positions[index] !== null) : undefined
      values = aligned !== undefined && aligned.length === names.length ? aligned : raw
      if (values.length !== names.length) {
        // The advanced set has its own slot list, so align it the same way.
        const wider = widgetInputNames(info, true, undefined, undefined, values)
        const widerNames = widgetNames(wider)
        const widerValues =
          wider.positions.length === values.length
            ? values.filter((_, index) => wider.positions[index] !== null)
            : values
        if (widerValues.length === widerNames.length) {
          names = widerNames
          values = widerValues
          curves.clear()
          for (const curveName of wider.curves) curves.add(curveName)
        }
      }
      const positional: Record<string, unknown> = {}
      names.forEach((name, index) => {
        if (name === CONTROL_AFTER_GENERATE || index >= values.length || linked.has(name)) return
        // A curve widget value rides the frontend's envelope; the backend
        // unwraps it during execution.
        positional[name] = curves.has(name)
          ? { __type__: 'CURVE', __value__: values[index] }
          : wrapWidgetValue(values[index])
      })
      if (values.length !== names.length) {
        warnings.push(`${node.type}: ${values.length} widget values for ${names.length} widgets`)
      }
      out = positional
    }
    // A required input the workflow carries no value for still has to be in the
    // prompt: the frontend's widgets always hold something, and ComfyUI rejects
    // the whole prompt when the key is absent (`ImageCompare`'s socketless
    // `compare_view` failed every Qwen-Image-Edit run that way).
    for (const [name, fallback] of requiredInputFallbacks(info, values)) {
      if (linked.has(name) || name in out) continue
      out[name] = wrapWidgetValue(fallback)
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
      // The resolver selects per requested type at resolve time, so it is
      // created unconditionally — an output whose positional input is unlinked
      // can still be fed by a later type-compatible input.
      alias[slot] = (type) => {
        const inputSlot = bypassInputSlot(node, slot, type)
        const link = inputSlot >= 0 ? (node.inputs?.[inputSlot]?.link ?? null) : null
        if (link == null) return undefined
        const resolved = resolveLink(link, links, remap, bindings)
        if (resolved === undefined) return undefined
        return isReference(resolved)
          ? { kind: 'ref', ref: resolved, type: node.inputs?.[inputSlot]?.type }
          : { kind: 'value', value: resolved }
      }
      if ((output.links ?? []).length > 0 && !(node.inputs ?? []).some((input) => input.link != null)) {
        warnings.push(`${kind} ${node.type} output ${slot} has no input to pass through`)
      }
    })
    aliases[String(id)] = alias
  }

  /**
   * The frontend applies a PrimitiveNode's value to the widget it feeds and
   * drops the node; the prompt has to read the same way. Consumers get the
   * value itself, so `Value: 3` feeding `steps` becomes `steps: 3`.
   */
  function emitPrimitive(node: UiNode, remap: Map<number, number>) {
    const value = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined
    const alias: Record<number, (type?: string) => AliasStep | undefined> = {}
    ;(node.outputs ?? []).forEach((_, slot) => {
      alias[slot] = () => ({ kind: 'value', value: wrapWidgetValue(value) })
    })
    aliases[String(remap.get(node.id)!)] = alias
  }

  function emit(
    node: UiNode,
    links: Map<number, UiLink>,
    remap: Map<number, number>,
    bindings: Map<number, Map<number, unknown>>
  ) {
    const id = remap.get(node.id)!
    if (node.type === PRIMITIVE_NODE) {
      emitPrimitive(node, remap)
      return
    }
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
    // A link that resolves to nothing — a promoted input the instance bound no
    // value to, a dangling link, an alias that ran out — leaves the input to the
    // value the node itself saved. The frontend reads it the same way: it
    // registers a promoted widget with the interior value and only overwrites it
    // when the instance actually carries one, so an unbound promotion is the
    // interior's value, not an absent input.
    const linked = new Set<string>()
    const inputs: Record<string, unknown> = {}
    for (const slot of node.inputs ?? []) {
      if (slot.link == null) continue
      const resolved = resolveLink(slot.link, links, remap, bindings)
      if (resolved === undefined) continue
      linked.add(slot.name)
      inputs[slot.name] = resolved
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

    // A promoted input spends a positional widget value when the interior backs
    // it with a widget; a socket-only promotion spends none, and only a link can
    // fill it. Linked widgets still spend their position — the frontend writes
    // one entry per widget-hosting slot whether or not it is linked.
    const widgetSlotOf = (def: { linkIds?: number[] }): { nodeId: number; name: string } | undefined => {
      for (const linkId of def.linkIds ?? []) {
        const link = innerLinks.get(linkId)
        if (!link) continue
        const slot = definition.nodes.find((node) => node.id === link.target_id)?.inputs?.[link.target_slot]
        if (slot?.widget) return { nodeId: link.target_id, name: slot.widget.name }
      }
      return undefined
    }

    // The saved positional values are read against the subgraph's own inputs, in
    // declaration order: `SubgraphNode.configure` rebuilds the instance's input
    // list from the subgraph's slots before `_applyPromotedWidgetValues` walks
    // it, and `serializeFromStoreState` writes one entry per slot that hosts a
    // widget. The `inputs[]` in the file is a different list — it can omit a
    // promoted widget altogether — so reading the positions off it shifts every
    // value that follows the omission.
    const innerBindings = new Map<number, Map<number, unknown>>()
    if (inputNodeId !== undefined) {
      const values = instance.widgets_values
      const saved = new Map((instance.inputs ?? []).map((slot) => [slot.name, slot]))
      const byName = new Map<string, unknown>()
      let widgetIndex = 0
      for (const def of definition.inputs ?? []) {
        const slot = saved.get(def.name)
        const widgetSlot = widgetSlotOf(def)
        const widget = widgetSlot !== undefined
        if (widgetSlot && def.type === 'STRING') {
          const target = innerRemap.get(widgetSlot.nodeId)
          if (target !== undefined) promotedText.push({ nodeId: String(target), input: widgetSlot.name })
        }
        if (slot?.link != null) {
          const bound = resolveLink(slot.link, links, remap, bindings)
          if (bound !== undefined) byName.set(def.name, bound)
        } else if (widget) {
          // Named values preserve bindings when promoted widgets are reordered.
          const named = instance.widgets_values_named?.[def.name]
          const value = named !== undefined ? named : Array.isArray(values) ? values[widgetIndex] : values?.[def.name]
          if (value !== undefined) byName.set(def.name, wrapWidgetValue(value))
        }
        if (widget) widgetIndex += 1
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
    // be rewritten to the inner producer. The output's declared type rides
    // along, so a bypass nested inside the subgraph still selects by the type
    // the eventual consumer asks for.
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
        if (origin !== undefined) {
          // The incoming consumer type rides into the subgraph (the frontend
          // resolves nested producers with it); the declared output type is
          // only the fallback when the consumer's type is unknown.
          alias[slot] = (type) => ({ kind: 'ref', ref: [String(origin), link.origin_slot], type: type ?? def.type })
        }
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
      if (step.kind === 'value') return step.value
      current = { ref: step.ref, type: step.type }
    }
  }

  // `resolveAlias` already follows a chain to its end — a bypass fed by a
  // bypass lands on the real producer or value in that one call — so a single
  // pass settles every consumer and a fixpoint loop would re-scan to no end.
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
    }
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

  // A prompt-shaped name first, then declaration order (the sort is stable): a
  // workflow that promotes both a caption and a style string means the caption.
  const promotedRank = (entry: { input: string }): number => {
    const rank = promptInputRank(entry.input)
    return rank === -1 ? PROMPT_INPUT_PREFERENCE.length : rank
  }
  promotedText.sort((a, b) => promotedRank(a) - promotedRank(b))

  return { prompt, warnings, promotedText }
}

/**
 * Prompt input names by preference; the SDXL, Flux, and SD3 text encodes split
 * their prompt across named streams, and Lumina2 names its own. The first
 * recognized stream receives the chat prompt, the workflow-authored values of
 * the others are preserved.
 */
const PROMPT_INPUT_PREFERENCE = ['text', 'prompt', 'text_g', 't5xxl', 'clip_g', 'clip_l', 'text_l', 'user_prompt']

/**
 * The rank of an input whose value is a prompt, read off the leaf of its key:
 * the backend nests a widget under the group it belongs to, so the prompt of
 * `QwenImageTextToImageApi` is `model.prompt` and its negative is
 * `model.negative_prompt` — the leaf is the widget's own name.
 */
const promptInputRank = (name: string): number => PROMPT_INPUT_PREFERENCE.indexOf(name.slice(name.lastIndexOf('.') + 1))

/**
 * Whether an input is where a prompt is asked for: `text` and its named
 * streams, or anything ending in `prompt`. Wider than the preference list on
 * purpose — the *negative* prompt is not a place to write the run's prompt, but
 * a graph that names one was built around a prompt, and a run that cannot find
 * the positive one has to refuse rather than submit the workflow with the
 * user's text dropped.
 */
const isPromptShaped = (name: string): boolean => {
  const leaf = name.slice(name.lastIndexOf('.') + 1)
  return leaf === 'text' || leaf.endsWith('prompt') || PROMPT_INPUT_PREFERENCE.includes(leaf)
}

/**
 * The conditioning a node names as its positive stream: a plain sampler says
 * `positive`, and `DualCFGGuider` — the Omnigen2 shape — numbers its streams
 * `cond1`, `cond2`, where the first carries the text and the second the
 * reference latent. The streams are tried in declaration order, so the
 * leftmost one wins. `conditioning` is not one of them: a combiner and a
 * forwarder name their single stream that way without being the sampler.
 */
function positiveConditioning(inputs: Record<string, unknown>): Reference | undefined {
  for (const [name, value] of Object.entries(inputs)) {
    if (!isReference(value)) continue
    if (name === 'positive' || /^cond\d+$/.test(name)) return value
  }
  return undefined
}

/**
 * Whether the graph holds any text a run's prompt could replace. A workflow
 * that holds none — an upscaler, a background remover, a depth estimator — has
 * nothing to write and runs as it was saved. A prompt-named input that is a
 * *reference* counts as text even though it holds no string itself: the graph
 * feeds that input from somewhere, and if the walk could not follow it to the
 * text, submitting the workflow would quietly drop the run's prompt.
 */
export function hasPromptText(prompt: Record<string, ApiPromptNode>): boolean {
  return Object.values(prompt).some(
    (node) =>
      (isValueSource(node) && typeof node.inputs.value === 'string') ||
      Object.entries(node.inputs).some(
        ([name, value]) => isPromptShaped(name) && (typeof value === 'string' || isReference(value))
      )
  )
}

/**
 * The value an If/Else Switch puts on the wire. Both of its value inputs are
 * lazy and exactly one is ever evaluated — `on_true` when its boolean `switch`
 * widget is on, `on_false` when it is off — so a walk that follows both can
 * end up on the branch the run discards. Verified against a live server: a
 * `ComfySwitchNode` feeding `PreviewAny` returns the selected branch's text for
 * either setting and never evaluates the other.
 *
 * Keyed on the declared input names rather than the class, so the same rule
 * covers any node that declares this shape.
 */
function selectedSwitchBranch(node: ApiPromptNode): { name: 'on_true' | 'on_false'; value: unknown } | undefined {
  const selector = node.inputs.switch
  if (typeof selector !== 'boolean') return undefined
  const name = selector ? 'on_true' : 'on_false'
  return name in node.inputs ? { name, value: node.inputs[name] } : undefined
}

export interface PromptTargetOptions {
  /** Text widgets the workflow promotes on a subgraph instance, from
   *  `ConversionResult.promotedText`. */
  promotedText?: { nodeId: string; input: string }[]
  /** The server's class table. It names the classes a run executes for their
   *  side effect, which is where the fallback walk starts. */
  objectInfo?: ObjectInfo
}

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
  prompt: Record<string, ApiPromptNode>,
  { promotedText = [], objectInfo }: PromptTargetOptions = {}
): { nodeId: string; input: string; samplerId: string } | undefined {
  // Prefer real samplers — nodes that hold their own seed or take the latent —
  // over conditioning transformers that merely forward a positive stream, so
  // the per-run seed is written where the graph samples, not into a side
  // branch.
  const conditioningInputs = (node: ApiPromptNode): Record<string, unknown> =>
    isReference(node.inputs.guider) ? (prompt[node.inputs.guider[0]]?.inputs ?? {}) : node.inputs
  const withPositive = Object.entries(prompt).filter(([, node]) => {
    // `conditioningInputs` follows one `guider` hop, so a sampler reading its
    // positive stream off `CFGGuider`/`DualCFGGuider` counts here too.
    const inputs = conditioningInputs(node)
    if (positiveConditioning(inputs) !== undefined) return true
    // A guider that names its only stream `conditioning` — `BasicGuider`.
    return isReference(node.inputs.guider) && isReference(inputs.conditioning)
  })
  const isSampler = ([, node]): boolean =>
    'seed' in node.inputs || 'noise_seed' in node.inputs || 'latent_image' in node.inputs
  const ordered = [...withPositive.filter(isSampler), ...withPositive.filter((entry) => !isSampler(entry))]

  /** All nodes reachable through reference inputs from a starting id. */
  const reachableFrom = (start: Reference): Set<string> => {
    const reached = new Set<string>()
    const queue = [start[0]]
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (reached.has(nodeId)) continue
      reached.add(nodeId)
      const node = prompt[nodeId]
      if (!node) continue
      for (const value of Object.values(node.inputs)) {
        if (isReference(value)) queue.push(value[0])
      }
    }
    return reached
  }

  /** Whether `target` is reachable from `from` through reference inputs. */
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>()
    const queue = [from]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (id === target) return true
      if (seen.has(id)) continue
      seen.add(id)
      const node = prompt[id]
      if (!node) continue
      for (const value of Object.values(node.inputs)) {
        if (isReference(value)) queue.push(value[0])
      }
    }
    return false
  }

  /**
   * The first text source reached from the node ids in `queue`, breadth first.
   * A node the graph cannot feed is its own value: a text widget the workflow
   * hoisted out of the sampler's chain. `value` is too generic a name to rank
   * above the prompt names, so it is only read off such a node.
   */
  const walk = (queue: string[], excluded?: Set<string>): { nodeId: string; input: string } | undefined => {
    const seen = new Set<string>()
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (seen.has(nodeId) || excluded?.has(nodeId)) continue
      seen.add(nodeId)
      const target = prompt[nodeId]
      if (!target) continue
      let best: { name: string; rank: number } | undefined
      for (const [name, value] of Object.entries(target.inputs)) {
        if (typeof value !== 'string') continue
        const rank = promptInputRank(name)
        if (rank !== -1 && (best === undefined || rank < best.rank)) best = { name, rank }
      }
      if (best) return { nodeId, input: best.name }
      // A `StringConcatenate` can keep the run's text as one of its own
      // literals — the style string linked in, the prompt typed into the node.
      // That literal is where the run writes; following the linked operand would
      // reach another node's constant and replace the workflow's style instead.
      if (target.class_type === 'StringConcatenate') {
        // Unless the workflow promotes the text of a node this one feeds: then
        // the promotion — the workflow's own statement of what a run supplies —
        // names the text, and the literal here is a style string.
        const promotedBelow = promotedText.some((entry) => reaches(nodeId, entry.nodeId))
        const literal = Object.entries(target.inputs).find(
          ([name, value]) => name !== 'delimiter' && typeof value === 'string' && value.length > 0
        )
        if (literal && !promotedBelow) return { nodeId, input: literal[0] }
        if (promotedBelow) continue
      }
      // A switch puts one branch on the wire and leaves the other unevaluated,
      // so only the selected branch is part of the graph the sampler reads.
      // When that branch carries the text as a literal — the workflow's own
      // "use this text" side of the switch — the literal is what the consumer
      // receives, which is where the prompt has to be written.
      const branch = selectedSwitchBranch(target)
      if (branch) {
        if (typeof branch.value === 'string') return { nodeId, input: branch.name }
        if (isReference(branch.value)) queue.push(branch.value[0])
        continue
      }
      if (isValueSource(target) && typeof target.inputs.value === 'string') {
        return { nodeId, input: 'value' }
      }
      const refs = Object.entries(target.inputs).filter((entry): entry is [string, Reference] => isReference(entry[1]))
      // Never follow an intermediate node's negative edge (e.g. a ControlNet
      // apply node carries both streams) — only the sampler's own negative
      // branch is out of bounds, not a conditioning input anywhere.
      const following = refs.filter(([name]) => name !== 'negative')
      // Follow the prompt edge before the node's other references when it lands
      // on a plain text node: a generator keeps its prompt, its style and its
      // reference image as separate sockets, and object order alone would let a
      // style source win. A prompt socket fed by *another* generator is not a
      // text edge — that node writes the prompt from its own input, and which
      // socket carries the workflow's text is the workflow's own choice.
      const textEdges = following.filter(([, value]) => {
        const producer = prompt[value[0]]
        return producer !== undefined && holdsText(producer) && isPlainTextNode(producer)
      })
      const shaped = textEdges.filter(([name]) => isPromptShaped(name))
      // A `StringConcatenate` with text on both operands — a style string on
      // one and the prompt on the other — says nothing about which one the run
      // supplies, and `string_a`/`string_b` rank nothing. Stop rather than pick
      // by object order: the run refuses a graph whose text it cannot place,
      // which beats overwriting the workflow's own style. A node that names its
      // inputs keeps object order, which is where the primary input sits.
      const joins = target.class_type === 'StringConcatenate'
      if (joins && shaped.length === 0 && textEdges.length > 1) continue
      const later: [string, Reference][] = []
      for (const entry of following) {
        const [name, value] = entry
        if (isPromptShaped(name) && textEdges.includes(entry)) queue.push(value[0])
        else later.push(entry)
      }
      for (const [, value] of later) queue.push(value[0])
    }
    return undefined
  }

  /** Every node that only a negative branch reaches, across the graph. */
  const negativeOnlyNodes = new Set<string>()
  for (const [samplerId, node] of ordered) {
    const inputs = conditioningInputs(node)
    const positive =
      positiveConditioning(inputs) ?? (isReference(inputs.conditioning) ? inputs.conditioning : undefined)
    if (!positive) continue
    // Only the negative-exclusive part of the graph is out of bounds: the
    // classic zero-out chain hangs a ConditioningZeroOut off the negative
    // encode, and crossing into it would replace the negative prompt. Nodes
    // shared with the positive branch stay reachable.
    const negative = inputs.negative
    const negativeOnly = isReference(negative)
      ? new Set([...reachableFrom(negative)].filter((id) => !reachableFrom(positive).has(id)))
      : new Set<string>()
    for (const id of negativeOnly) negativeOnlyNodes.add(id)
    const found = walk([positive[0]], negativeOnly)
    if (found) return { ...found, samplerId }
  }

  // A self-contained generator — one node that takes the prompt as a widget and
  // samples it internally, e.g. MiniMaxH3MLXTurbo — has no `positive` edge to
  // walk: the prompt and the seed are both its own widgets. Nothing better can
  // be said about which text input a graph means, so start from the nodes that
  // sample, lowest node id first, and take the first text source reached from
  // one: the node's own prompt input, or the text node it links to — a Gemini
  // or Seedream generator keeps its prompt in a Primitive it references.
  const byNodeId = (a: string, b: string): number => {
    // A node id is a string to the API but a number to ComfyUI: ordering the
    // tie-break lexicographically would read "10" as lower than "9".
    const left = Number(a)
    const right = Number(b)
    if (Number.isInteger(left) && Number.isInteger(right) && left !== right) return left - right
    return a < b ? -1 : a > b ? 1 : 0
  }
  const orderedIds = Object.keys(prompt).sort(byNodeId)
  const samplingIds = orderedIds.filter((id) => seedInputKey(prompt[id].inputs) !== undefined)

  /**
   * The node a per-run seed belongs to: the root when it samples, otherwise the
   * sampling node the target is reachable from. A target no sampling node
   * reaches names itself, which writes no seed at all — landing the run's seed
   * on whichever node happens to hold one would change a setting the run never
   * touched.
   */
  const seedNodeFor = (target: string, root: string): string => {
    if (seedInputKey(prompt[root]?.inputs ?? {}) !== undefined) return root
    return samplingIds.find((id) => reaches(id, target)) ?? target
  }

  // A graph with no seed at all still generates — the hosted image nodes
  // (`RunwayTextToImageNode` and friends) keep no seed — so the second pass
  // drops that requirement and walks back from where a run ends: the classes
  // the server executes for their side effect, or, when it does not know them,
  // the nodes nothing else reads.
  const referenced = new Set<string>()
  for (const node of Object.values(prompt)) {
    for (const value of Object.values(node.inputs)) {
      if (isReference(value)) referenced.add(value[0])
    }
  }
  const outputIds = orderedIds.filter((id) => objectInfo?.[prompt[id].class_type]?.output_node === true)
  const rootIds = outputIds.length > 0 ? outputIds : orderedIds.filter((id) => !referenced.has(id))
  for (const roots of [samplingIds, rootIds]) {
    for (const root of roots) {
      const found = walk([root])
      if (found) return { ...found, samplerId: seedNodeFor(found.nodeId, root) }
    }
  }

  // Last, the field the workflow itself promotes. A subgraph that exposes a
  // STRING widget — the Qwen-Image template style string, a `string_a` the
  // graph joins into the encode — names the text a run is meant to supply even
  // when the walk above cannot tell it apart from the graph's own constants.
  // It still has to be a text the run reads: a promotion that only the negative
  // branch reaches, or that nothing a run executes reaches at all, would put
  // the prompt somewhere the user never meant it.
  for (const entry of promotedText) {
    if (typeof prompt[entry.nodeId]?.inputs[entry.input] !== 'string') continue
    if (negativeOnlyNodes.has(entry.nodeId)) continue
    if (!rootIds.some((id) => reaches(id, entry.nodeId))) continue
    const sampler = samplingIds.find((id) => reaches(id, entry.nodeId))
    return { ...entry, samplerId: sampler ?? entry.nodeId }
  }

  return undefined
}

/**
 * ComfyUI seeds are integers, and a workflow usually pins one. Write the sampler that
 * consumes the prompt, so two runs differ; a graph that keeps the seed on a shared node
 * feeding that sampler instead gets it there. Regular samplers read `seed`; advanced
 * variants (KSamplerAdvanced and friends, which schedule their own noise) read `noise_seed`.
 * A seed the backend nests under a widget group (`model.seed`, `sampling_mode.seed`) is
 * read and written by its full key, so the per-run value lands where the graph reads it.
 */
export function applySeed(graph: Record<string, ApiPromptNode>, seed: number | undefined, samplerId?: string): void {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return
  const value = Math.trunc(seed)
  const sampler = samplerId ? graph[samplerId] : undefined
  if (sampler) {
    const key = seedInputKey(sampler.inputs)
    if (key) {
      writeSeed(graph, sampler.inputs, key, value)
      return
    }
    const seen = new Set<string>()
    let noise = sampler.inputs.noise
    while (isReference(noise) && !seen.has(noise[0])) {
      seen.add(noise[0])
      const source = graph[noise[0]]
      if (!source) break
      const key = seedInputKey(source.inputs)
      if (key) {
        writeSeed(graph, source.inputs, key, value)
        return
      }
      noise = source.inputs.noise
    }
    return
  }
  for (const node of Object.values(graph)) {
    const key = seedInputKey(node.inputs)
    if (key) {
      writeSeed(graph, node.inputs, key, value)
      return
    }
  }
}

/**
 * The key a node keeps its seed under, or undefined when it holds none. The
 * plain names win over a nested one so a node that carries both keeps writing
 * the seed it always wrote; a node that only nests its seed — the API
 * generators and the newer template nodes do — still counts as one that samples.
 */
const seedInputKey = (inputs: Record<string, unknown>): string | undefined => {
  if ('seed' in inputs) return 'seed'
  if ('noise_seed' in inputs) return 'noise_seed'
  return Object.keys(inputs).find((key) => key.endsWith('.seed') || key.endsWith('.noise_seed'))
}

/**
 * Write the seed into `inputs[key]`. A linked seed input is rewritten at its
 * source node — the node the sampler pulls the seed from usually holds the
 * pinning widget (a seed generator, or PrimitiveInt's `value`) — so the
 * connection is kept, not severed.
 */
function writeSeed(
  graph: Record<string, ApiPromptNode>,
  inputs: Record<string, unknown>,
  key: string,
  value: number
): void {
  const current = inputs[key]
  if (isReference(current)) {
    const source = graph[current[0]]
    const sourceKey = source
      ? (seedInputKey(source.inputs) ??
        ('value' in source.inputs && !isReference(source.inputs.value) ? 'value' : undefined))
      : undefined
    if (sourceKey) {
      source.inputs[sourceKey] = value
      return
    }
  }
  inputs[key] = value
}

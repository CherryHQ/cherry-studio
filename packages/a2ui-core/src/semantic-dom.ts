import { ComponentContext, GenericBinder, type ComponentApi, type SurfaceModel } from './v0_9'

export class UnknownSemanticComponentError extends Error {
  constructor(type: string, id: string) {
    super(`Unknown A2UI component type "${type}" (component id "${id}").`)
    this.name = 'UnknownSemanticComponentError'
  }
}

type Disposable = { unsubscribe(): void } | { dispose(): void }

function childRefs(value: unknown): Array<{ id: string; basePath?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [{ id: entry }]
    if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string')
      return [
        {
          id: entry.id,
          basePath: 'basePath' in entry && typeof entry.basePath === 'string' ? entry.basePath : undefined
        }
      ]
    return []
  })
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function elementFor(type: string, props: Record<string, unknown>): HTMLElement {
  switch (type) {
    case 'Text': {
      const el = document.createElement('p')
      el.textContent = text(props.text)
      return el
    }
    case 'Button': {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = text(props.label)
      el.disabled = props.disabled === true
      if (typeof props.action === 'function') el.addEventListener('click', props.action as EventListener)
      return el
    }
    case 'TextField': {
      const wrap = document.createElement('label')
      wrap.textContent = text(props.label)
      const input = document.createElement('input')
      input.value = text(props.value)
      input.setAttribute('aria-invalid', String(props.isValid === false))
      input.addEventListener('input', () => typeof props.setValue === 'function' && props.setValue(input.value))
      wrap.append(input)
      return wrap
    }
    case 'CheckBox': {
      const wrap = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = props.value === true
      input.addEventListener('change', () => typeof props.setValue === 'function' && props.setValue(input.checked))
      wrap.append(input, document.createTextNode(text(props.label)))
      return wrap
    }
    case 'ChoicePicker': {
      const wrap = document.createElement('label')
      wrap.append(document.createTextNode(text(props.label)))
      const select = document.createElement('select')
      select.multiple = props.variant === 'multipleSelection'
      const selected = new Set(Array.isArray(props.value) ? props.value.map(String) : [text(props.value)])
      for (const option of Array.isArray(props.options) ? props.options : []) {
        if (!option || typeof option !== 'object') continue
        const node = document.createElement('option')
        node.value = text((option as Record<string, unknown>).value)
        node.textContent = text((option as Record<string, unknown>).label)
        node.selected = selected.has(node.value)
        select.append(node)
      }
      wrap.append(select)
      return wrap
    }
    case 'Row': {
      const el = document.createElement('div')
      el.setAttribute('role', 'group')
      el.dataset.layout = 'row'
      return el
    }
    case 'Column': {
      const el = document.createElement('div')
      el.dataset.layout = 'column'
      return el
    }
    case 'Card':
      return document.createElement('section')
    case 'Divider': {
      const el = document.createElement('hr')
      if (props.axis === 'vertical') el.setAttribute('aria-orientation', 'vertical')
      return el
    }
    default:
      throw new UnknownSemanticComponentError(type, 'unknown')
  }
}

export interface SemanticRendererHandle {
  dispose(): void
  refresh(): void
}

export function renderSemanticSurface(
  surface: SurfaceModel<ComponentApi>,
  container: HTMLElement
): SemanticRendererHandle {
  let disposables: Disposable[] = []
  let rendering = false
  const cleanup = () => {
    for (const item of disposables) 'unsubscribe' in item ? item.unsubscribe() : item.dispose()
    disposables = []
  }
  const refresh = () => {
    if (rendering) return
    rendering = true
    cleanup()
    container.replaceChildren()
    const rootId = surface.componentsModel.get('root') ? 'root' : surface.componentsModel.entries.next().value?.[0]
    const renderNode = (id: string, basePath = '/'): HTMLElement | null => {
      const model = surface.componentsModel.get(id)
      if (!model) return null
      const api = surface.catalog.components.get(model.type)
      if (!api) throw new UnknownSemanticComponentError(model.type, id)
      const binder = new GenericBinder<Record<string, unknown>>(new ComponentContext(surface, id, basePath), api.schema)
      disposables.push(
        binder,
        binder.subscribe(() => queueMicrotask(refresh))
      )
      const props = binder.snapshot
      let element: HTMLElement
      try {
        element = elementFor(model.type, props)
      } catch (error) {
        if (error instanceof UnknownSemanticComponentError) throw new UnknownSemanticComponentError(model.type, id)
        throw error
      }
      element.dataset.a2uiComponent = model.type
      element.dataset.a2uiId = id
      const children =
        model.type === 'Card' || model.type === 'Button'
          ? childRefs([props.child ?? model.properties.child])
          : childRefs(props.children)
      for (const child of children) {
        const childElement = renderNode(child.id, child.basePath ?? basePath)
        if (childElement) element.append(childElement)
      }
      return element
    }
    if (rootId) {
      const root = renderNode(rootId)
      if (root) container.append(root)
    }
    disposables.push(
      surface.componentsModel.onCreated.subscribe(() => queueMicrotask(refresh)),
      surface.componentsModel.onDeleted.subscribe(() => queueMicrotask(refresh))
    )
    rendering = false
  }
  refresh()
  return { refresh, dispose: cleanup }
}

export const UAR_CONFORMANCE_COMPONENTS = [
  { id: 'root', component: 'Column', children: ['heading', 'row', 'field', 'choice', 'card', 'divider'] },
  { id: 'heading', component: 'Text', variant: 'h2', text: { path: '/heading' } },
  { id: 'row', component: 'Row', children: ['check', 'button'] },
  { id: 'check', component: 'CheckBox', label: 'Subscribe', value: { path: '/subscribed' } },
  { id: 'button', component: 'Button', child: 'button-label', action: { event: { name: 'continue', context: {} } } },
  { id: 'button-label', component: 'Text', text: 'Continue' },
  { id: 'field', component: 'TextField', label: 'Name', value: { path: '/name' } },
  {
    id: 'choice',
    component: 'ChoicePicker',
    label: 'Region',
    options: [
      { label: 'East', value: 'east' },
      { label: 'West', value: 'west' }
    ],
    value: { path: '/region' }
  },
  { id: 'card', component: 'Card', child: 'card-text' },
  { id: 'card-text', component: 'Text', text: 'Card content' },
  { id: 'divider', component: 'Divider' }
] as const
export const UAR_CONFORMANCE_DATA = {
  heading: 'Runtime surface',
  subscribed: true,
  name: 'Ada',
  region: 'east'
} as const

export interface SemanticSnapshot {
  text: string
  buttons: string[]
  checkboxes: Array<{ name: string; checked: boolean }>
  inputs: Array<{ name: string; value: string }>
  separators: number
}
export function semanticSnapshot(root: ParentNode): SemanticSnapshot {
  const labels = (element: Element) => {
    const id = element.getAttribute('id')
    const explicit = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : undefined
    return (
      element.getAttribute('aria-label') ||
      explicit ||
      element.closest('label')?.textContent?.trim() ||
      element.textContent?.trim() ||
      ''
    )
  }
  return {
    text: root.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    buttons: [...root.querySelectorAll('button')].map(labels),
    checkboxes: [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((element) => ({
      name: labels(element),
      checked: element.checked
    })),
    inputs: [...root.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')].map((element) => ({
      name: labels(element),
      value: element.value
    })),
    separators: root.querySelectorAll('hr,[role="separator"]').length
  }
}

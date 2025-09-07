/**
 * 数据重构，临时存放的默认值，需在全部完成后重新整理，并整理到preferences.ts中
 */

import type { SelectionActionItem } from './preferenceTypes'

export const defaultActionItems: SelectionActionItem[] = [
  { id: 'translate', name: 'selection.action.builtin.translate', enabled: true, isBuiltIn: true, icon: 'languages' },
  { id: 'explain', name: 'selection.action.builtin.explain', enabled: true, isBuiltIn: true, icon: 'file-question' },
  { id: 'summary', name: 'selection.action.builtin.summary', enabled: true, isBuiltIn: true, icon: 'scan-text' },
  {
    id: 'search',
    name: 'selection.action.builtin.search',
    enabled: true,
    isBuiltIn: true,
    icon: 'search',
    searchEngine: 'Google|https://www.google.com/search?q={{queryString}}'
  },
  { id: 'copy', name: 'selection.action.builtin.copy', enabled: true, isBuiltIn: true, icon: 'clipboard-copy' },
  { id: 'refine', name: 'selection.action.builtin.refine', enabled: false, isBuiltIn: true, icon: 'wand-sparkles' },
  { id: 'quote', name: 'selection.action.builtin.quote', enabled: false, isBuiltIn: true, icon: 'quote' }
]

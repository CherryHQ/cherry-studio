import { ActionToolSpec } from './types'

export const TOOL_SPECS: Record<string, ActionToolSpec> = {
  // Core tools
  copy: {
    id: 'copy',
    type: 'core',
    order: 11
  },
  download: {
    id: 'download',
    type: 'core',
    order: 10
  },
  edit: {
    id: 'edit',
    type: 'core',
    order: 12
  },
  'view-source': {
    id: 'view-source',
    type: 'core',
    order: 12
  },
  save: {
    id: 'save',
    type: 'core',
    order: 13
  },
  expand: {
    id: 'expand',
    type: 'core',
    order: 20
  },
  // Quick tools
  'split-view': {
    id: 'split-view',
    type: 'quick',
    order: 10
  },
  run: {
    id: 'run',
    type: 'quick',
    order: 11
  },
  wrap: {
    id: 'wrap',
    type: 'quick',
    order: 20
  },
  'copy-image': {
    id: 'copy-image',
    type: 'quick',
    order: 30
  },
  'download-svg': {
    id: 'download-svg',
    type: 'quick',
    order: 31
  },
  'download-png': {
    id: 'download-png',
    type: 'quick',
    order: 32
  },
  'zoom-in': {
    id: 'zoom-in',
    type: 'quick',
    order: 40
  },
  'zoom-out': {
    id: 'zoom-out',
    type: 'quick',
    order: 41
  }
}

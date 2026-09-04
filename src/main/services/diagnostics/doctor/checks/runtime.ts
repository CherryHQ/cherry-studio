import { application } from '@application'

import { defineDoctorCheck } from '../types'

export const managedTools = defineDoctorCheck({
  id: 'runtime-managed-tools',
  async run() {
    const inventory = await application.get('BinaryManager').getToolInventory()
    const failed = inventory.filter((tool) => tool.status === 'failed')
    if (failed.length === 0) return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'failed', params: { count: failed.length } },
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }],
      devMessage: `Managed tools with a broken installation or failed operation: ${failed.map((tool) => tool.name).join(', ')}`,
      evidence: [{ key: 'tools', value: failed.map((tool) => tool.name).join(', '), dataClass: 'public' }]
    }
  },
  fixes: {}
})

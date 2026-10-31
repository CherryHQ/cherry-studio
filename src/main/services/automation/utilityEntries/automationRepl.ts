import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import type { AutomationKernelContract } from '../contracts'
import { AutomationKernel } from './AutomationKernel'

const kernel = new AutomationKernel()
serveUtilityProcess<AutomationKernelContract>({
  id: 'automation.repl',
  handlers: { execute: (input, context) => kernel.execute(input, context) },
  dispose: () => kernel.dispose()
})

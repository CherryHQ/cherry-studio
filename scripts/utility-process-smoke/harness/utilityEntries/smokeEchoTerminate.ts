import { serveUtilityProcess } from '../../../../src/main/core/utilityProcess/runtime/serveUtilityProcess'
import type { SmokeContract, SmokeInitData } from '../smokeContract'
import { dispose, initialize, smokeHandlers } from './smokeEchoHandlers'

serveUtilityProcess<SmokeContract, SmokeInitData>({
  id: 'smoke.terminate',
  initialize,
  handlers: smokeHandlers,
  dispose
})

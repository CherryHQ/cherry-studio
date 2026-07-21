import { stopOnTerminalToolFailure } from '../../loop/toolLoopTermination'
import type { RequestFeature } from '../feature'

/** End the loop after a trusted builtin web tool reports that retrying cannot succeed. */
export const terminalToolFailureFeature: RequestFeature = {
  name: 'terminal-tool-failure',
  contributeStopConditions: () => [stopOnTerminalToolFailure]
}

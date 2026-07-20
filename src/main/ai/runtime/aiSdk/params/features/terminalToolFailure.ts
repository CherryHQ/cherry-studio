import { stopOnTerminalToolFailure } from '../../loop/toolLoopTermination'
import type { RequestFeature } from '../feature'

/** End the loop after a tool explicitly reports that retrying cannot succeed. */
export const terminalToolFailureFeature: RequestFeature = {
  name: 'terminal-tool-failure',
  contributeStopConditions: () => [stopOnTerminalToolFailure]
}

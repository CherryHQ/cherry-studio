/**
 * Entry-side API: the last statement of every utility-process entry module. Child-safe.
 */

import type { UtilityProcessContract } from '../types'
import { createUtilityProcessServer, type ServeUtilityProcessOptions } from './utilityProcessServer'

export type {
  ServeUtilityProcessOptions,
  UtilityProcessHandlerContext,
  UtilityProcessHandlers,
  UtilityProcessLogger
} from './utilityProcessServer'

export function serveUtilityProcess<Contract extends UtilityProcessContract, InitData = void>(
  options: ServeUtilityProcessOptions<Contract, InitData>
): void {
  const parentPort = process.parentPort
  if (parentPort === undefined) {
    throw new Error('serveUtilityProcess() must run inside an Electron utility process (process.parentPort is missing)')
  }
  createUtilityProcessServer(options, {
    parentPort,
    exit: (code) => process.exit(code),
    onFatal: (handler) => {
      process.on('uncaughtException', handler)
      process.on('unhandledRejection', handler)
    }
  })
}

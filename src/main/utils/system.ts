import os from 'node:os'

import { isMac, isWin } from '@main/constant'

export const getDeviceType = () => (isMac ? 'mac' : isWin ? 'windows' : 'linux')

export const getHostname = () => os.hostname()

export const getCpuName = () => {
  try {
    const cpus = os.cpus()
    if (!cpus || cpus.length === 0 || !cpus[0].model) {
      return 'Unknown CPU'
    }
    return cpus[0].model
  } catch {
    return 'Unknown CPU'
  }
}

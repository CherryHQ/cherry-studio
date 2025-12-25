import os from 'node:os'

import { isMac, isWin } from '@main/constant'

export const getDeviceType = () => (isMac ? 'mac' : isWin ? 'windows' : 'linux')

export const getHostname = () => os.hostname()

export const getCpuName = () => os.cpus()[0].model

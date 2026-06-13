import { execSync } from 'node:child_process'
import os from 'node:os'

import { isMac, isWin } from '@main/core/platform'

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

export const getGpuNames = (): string[] => {
  try {
    if (isWin) {
      // PowerShell CIM query returns one GPU name per line.
      const output = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
        { encoding: 'utf-8', windowsHide: true }
      )
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    }

    if (isMac) {
      // system_profiler reports each GPU under a "Chipset Model:" entry.
      const output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf-8' })
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('Chipset Model:'))
        .map((line) => line.replace('Chipset Model:', '').trim())
        .filter(Boolean)
    }

    // Linux: lspci lists VGA/3D/Display controllers.
    const output = execSync('lspci', { encoding: 'utf-8' })
    return output
      .split(/\r?\n/)
      .filter((line) => /VGA compatible controller|3D controller|Display controller/i.test(line))
      .map((line) => line.replace(/^.*controller:\s*/i, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

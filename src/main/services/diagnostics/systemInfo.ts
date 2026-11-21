import { release } from 'node:os'

import { app } from 'electron'

import agentPythonRuntime from '@shared/data/presets/agentPythonRuntime.json'

import type { DiagnosticWarning } from './types'

interface DiagnosticSystemSnapshot {
  readonly application?: {
    readonly isPackaged: boolean
    readonly name: string
    readonly version: string
  }
  readonly operatingSystem: {
    readonly arch: string
    readonly locale: string
    readonly platform: NodeJS.Platform
    readonly release: string
    readonly timezone?: string
  }
  readonly runtime: {
    readonly chrome?: string
    readonly electron?: string
    readonly node?: string
    readonly v8?: string
    readonly agentPythonImage: string
    readonly managedPyodide: string
    readonly managedPython: string
    readonly managedOpenpyxl: string
    readonly managedEtXmlfile: string
  }
}

function collectValue<T>(warnings: Set<DiagnosticWarning>, collector: () => T): T | undefined {
  try {
    return collector()
  } catch {
    warnings.add('system_info_unavailable')
    return undefined
  }
}

export async function collectDiagnosticSystemInfo(warnings: Set<DiagnosticWarning>): Promise<DiagnosticSystemSnapshot> {
  const application = collectValue(warnings, () => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion()
  }))

  return {
    application,
    operatingSystem: {
      arch: process.arch,
      locale: collectValue(warnings, () => app.getLocale()) ?? 'unknown',
      platform: process.platform,
      release: collectValue(warnings, release) ?? 'unknown',
      timezone: collectValue(warnings, () => Intl.DateTimeFormat().resolvedOptions().timeZone)
    },
    runtime: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
      v8: process.versions.v8,
      agentPythonImage: agentPythonRuntime.imageVersion,
      managedPyodide: agentPythonRuntime.pyodideVersion,
      managedPython: agentPythonRuntime.pythonVersion,
      managedOpenpyxl: agentPythonRuntime.packages.openpyxl,
      managedEtXmlfile: agentPythonRuntime.packages['et-xmlfile']
    }
  }
}

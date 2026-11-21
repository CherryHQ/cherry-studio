import manifest from '@shared/data/presets/agentPythonRuntime.json'

export interface ManagedPythonRuntime {
  version: string
  loadPackage: (name: string) => Promise<unknown>
  runPython: (code: string) => unknown
}

export interface AgentPythonDiagnostics {
  imageVersion: string
  pyodide: string
  python: string
  openpyxl: string
  etXmlfile: string
}

/** Load managed packages before accepting code, without invoking a package installer. */
export async function prepareManagedPythonRuntime(runtime: ManagedPythonRuntime): Promise<AgentPythonDiagnostics> {
  try {
    if (runtime.version !== manifest.pyodideVersion) throw new Error('Unexpected Pyodide version')
    await runtime.loadPackage('openpyxl')
    const versions = runtime.runPython(
      "__import__('json').dumps({'openpyxl': __import__('openpyxl').__version__, 'etXmlfile': __import__('importlib.metadata', fromlist=['version']).version('et-xmlfile'), 'python': __import__('platform').python_version()})"
    )
    const installed = JSON.parse(String(versions)) as { openpyxl: string; etXmlfile: string; python: string }
    if (
      installed.openpyxl !== manifest.packages.openpyxl ||
      installed.etXmlfile !== manifest.packages['et-xmlfile'] ||
      installed.python !== manifest.pythonVersion
    )
      throw new Error('Managed package versions do not match the runtime image')
    return { imageVersion: manifest.imageVersion, pyodide: runtime.version, ...installed }
  } catch {
    throw new Error(
      'Managed Python dependency openpyxl could not be loaded. Repair the application installation and try again. No package installation was attempted.'
    )
  }
}

import { spawn } from 'node:child_process'
import { application } from '@application'
import { mergeBinaryExecutionEnv, getBinarySearchDirs, mergePathPrefixes } from '@main/utils/binaryEnv'

export function runIntegrationProcess(command: string, args: string[], options: {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  onOutput?: (output: string) => void
  secrets?: string[]
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = mergeBinaryExecutionEnv(mergePathPrefixes(
      Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      [application.getPath('feature.prometheus.commands'), ...getBinarySearchDirs()]
    ))
    const child = spawn(command, args, { cwd: options.cwd, env: { ...env, ...options.env }, signal: options.signal, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    // Redact complete accumulated text, including a credential split across stream chunks.
    const redact = (text: string) => (options.secrets ?? []).filter(Boolean).reduce((value, secret) => value.split(secret).join('[redacted]'), text)
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-262144)
      options.onOutput?.(redact(output))
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(redact(output)) : reject(new Error(redact(output) || `Process exited with code ${code}`)))
  })
}

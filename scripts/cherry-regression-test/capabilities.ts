import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { RunPaths } from './paths'
import type { CapabilityResult, Platform } from './types'

function commandAvailable(command: string, args: string[]): CapabilityResult {
  try {
    const version = execFileSync(command, args, { encoding: 'utf8', timeout: 10_000 }).trim()
    return { available: true, detail: version || `${command} Available` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `Command unavailable: ${detail}` }
  }
}

function probeNpx(platform: Platform): CapabilityResult {
  if (platform !== 'windows') return commandAvailable('npx', ['--version'])
  return commandAvailable(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx --version'])
}

function probeDesktopAutomation(platform: Platform): CapabilityResult {
  try {
    if (platform === 'macos') {
      const enabled = execFileSync(
        'osascript',
        ['-e', 'tell application "System Events" to return UI elements enabled'],
        { encoding: 'utf8', timeout: 10_000 }
      ).trim()
      return {
        available: enabled === 'true',
        detail:
          enabled === 'true'
            ? 'macOS System Events accessibility automation is enabled'
            : 'macOS System Events accessibility automation is disabled'
      }
    }

    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '$null = New-Object -ComObject WScript.Shell'],
      { stdio: 'ignore', timeout: 10_000 }
    )
    return { available: true, detail: 'Windows desktop input automation is available' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `Desktop automation unavailable: ${detail}` }
  }
}

function probeScreenCapture(platform: Platform, paths: RunPaths): CapabilityResult {
  const outputPath = join(paths.evidence, 'capability-screen.png')
  try {
    if (platform === 'macos') {
      execFileSync('screencapture', ['-x', outputPath], { stdio: 'ignore', timeout: 15_000 })
    } else {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
        '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
        '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
        '$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
        `$bitmap.Save('${outputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        '$graphics.Dispose()',
        '$bitmap.Dispose()'
      ].join('; ')
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: 'ignore',
        timeout: 15_000
      })
    }
    if (!existsSync(outputPath)) throw new Error('Screenshot command did not produce an image')
    return { available: true, detail: `Desktop screenshot saved to ${outputPath}` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `Screen capture unavailable: ${detail}` }
  }
}

export function probeCapabilities(platform: Platform, paths: RunPaths): Record<string, CapabilityResult> {
  const desktopAutomation = probeDesktopAutomation(platform)
  const screenCapture = probeScreenCapture(platform, paths)
  const directCdp = commandAvailable(process.execPath, [
    '-e',
    "require.resolve('ws'); process.stdout.write('Direct CDP connection available')"
  ])

  return {
    desktopAutomation,
    externalSelection: {
      available: desktopAutomation.available && screenCapture.available,
      detail: desktopAutomation.available
        ? screenCapture.detail
        : `Cross-app text selection requires desktop automation: ${desktopAutomation.detail}`
    },
    globalShortcut: {
      available: desktopAutomation.available,
      detail: desktopAutomation.available
        ? 'Desktop automation can focus external apps and send configured shortcuts'
        : desktopAutomation.detail
    },
    directCdp,
    npx: probeNpx(platform),
    screenCapture,
    systemFilePicker: {
      available: desktopAutomation.available,
      detail: desktopAutomation.available
        ? 'Desktop automation can operate native file pickers'
        : desktopAutomation.detail
    }
  }
}

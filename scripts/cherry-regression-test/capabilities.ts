import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { RunPaths } from './paths'
import type { CapabilityResult, Platform } from './types'

function commandAvailable(command: string, args: string[]): CapabilityResult {
  try {
    const version = execFileSync(command, args, { encoding: 'utf8', timeout: 10_000 }).trim()
    return { available: true, detail: version || `${command} 可用` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `命令不可用：${detail}` }
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
        detail: enabled === 'true' ? 'macOS 系统事件辅助功能自动化已启用' : 'macOS 系统事件辅助功能未启用'
      }
    }

    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '$null = New-Object -ComObject WScript.Shell'],
      { stdio: 'ignore', timeout: 10_000 }
    )
    return { available: true, detail: 'Windows 桌面输入自动化可用' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `桌面自动化不可用：${detail}` }
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
    if (!existsSync(outputPath)) throw new Error('截图命令未生成图片')
    return { available: true, detail: `桌面截图已保存至 ${outputPath}` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { available: false, detail: `屏幕截图不可用：${detail}` }
  }
}

export function probeCapabilities(platform: Platform, paths: RunPaths): Record<string, CapabilityResult> {
  const desktopAutomation = probeDesktopAutomation(platform)
  const screenCapture = probeScreenCapture(platform, paths)
  const directCdp = commandAvailable(process.execPath, [
    '-e',
    "require.resolve('ws'); process.stdout.write('CDP 直连可用')"
  ])

  return {
    desktopAutomation,
    externalSelection: {
      available: desktopAutomation.available && screenCapture.available,
      detail: desktopAutomation.available
        ? screenCapture.detail
        : `跨应用划词需要桌面自动化：${desktopAutomation.detail}`
    },
    globalShortcut: {
      available: desktopAutomation.available,
      detail: desktopAutomation.available ? '桌面自动化可聚焦外部应用并发送已配置的快捷键' : desktopAutomation.detail
    },
    directCdp,
    npx: probeNpx(platform),
    screenCapture,
    systemFilePicker: {
      available: desktopAutomation.available,
      detail: desktopAutomation.available ? '桌面自动化可操作系统原生文件选择器' : desktopAutomation.detail
    }
  }
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 从 `atsutil fonts -list` 输出中解析系统字体家族列表（仅 macOS）。
 * 说明：只取 `System Families:` 段落，避免把具体字体（PostScript 名）混进来。
 */
export function parseMacAtsutilFontFamilies(output: string): string[] {
  const lines = output.split(/\r?\n/g)
  let inFamiliesSection = false
  const families: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inFamiliesSection) {
      if (trimmed === 'System Families:') {
        inFamiliesSection = true
      }
      continue
    }

    if (!trimmed) continue

    // 家族名可能包含空格，因此只做前缀空白裁剪
    families.push(line.replace(/^\s+/, '').trim())
  }

  if (families.length === 0) return []

  return Array.from(new Set(families))
    .filter((name) => name.length > 0)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 获取 macOS 系统字体家族列表。
 * 优先走 `atsutil fonts -list`（覆盖面更完整），失败则返回空数组让调用方回退其他方案。
 */
export async function getMacSystemFontFamilies(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('atsutil', ['fonts', '-list'], {
      maxBuffer: 1024 * 1024 * 10
    })
    return parseMacAtsutilFontFamilies(String(stdout ?? ''))
  } catch {
    return []
  }
}

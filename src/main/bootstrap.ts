import { occupiedDirs } from '@shared/config/constant'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import { initAppDataDir } from './utils/init'

app.isPackaged && initAppDataDir()

// 在主进程中复制 appData 中某些一直被占用的文件
// 在renderer进程还没有启动时，主进程可以复制这些文件到新的appData中
function copyOccupiedDirsInMainProcess() {
  const newAppDataPath = process.argv
    .slice(1)
    .find((arg) => arg.startsWith('--new-data-path='))
    ?.split('--new-data-path=')[1]
  if (!newAppDataPath) {
    return
  }

  if (process.platform === 'win32') {
    const appDataPath = app.getPath('userData')
    occupiedDirs.forEach((dir) => {
      const dirPath = path.join(appDataPath, dir)
      const newDirPath = path.join(newAppDataPath, dir)
      if (fs.existsSync(dirPath)) {
        fs.cpSync(dirPath, newDirPath, { recursive: true })
      }
    })
  }
}

copyOccupiedDirsInMainProcess()

// Copy built-in skills to the user-level .claude/skills directory so they are
// available to all Claude Code agent sessions via CLAUDE_CONFIG_DIR.
function installBuiltinSkills() {
  const resourceSkillsPath = path.join(app.getAppPath(), 'resources', 'skills')
  const destSkillsPath = path.join(app.getPath('userData'), '.claude', 'skills')

  if (!fs.existsSync(resourceSkillsPath)) {
    return
  }

  const skills = fs.readdirSync(resourceSkillsPath, { withFileTypes: true })
  for (const entry of skills) {
    if (!entry.isDirectory()) continue
    const destPath = path.join(destSkillsPath, entry.name)
    if (fs.existsSync(destPath)) continue
    fs.mkdirSync(destPath, { recursive: true })
    fs.cpSync(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
  }
}

installBuiltinSkills()

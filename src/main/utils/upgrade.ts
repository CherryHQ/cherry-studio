import { spawn } from 'child_process'
import { app, dialog } from 'electron'
import Logger from 'electron-log'
import fs from 'fs'
import path from 'path'

export async function updateUserDataPath() {
  const currentPath = app.getPath('userData')
  const oldPath = currentPath.replace('CherryStudio', 'cherry-studio')

  if (currentPath !== oldPath && fs.existsSync(oldPath)) {
    Logger.log('Update userData path')

    try {
      if (process.platform === 'win32') {
        // Windows 系统：创建 bat 文件
        const batPath = await createWindowsBatFile(oldPath, currentPath)
        await promptRestartAndExecute(batPath)
      } else {
        // 其他系统：直接更新
        fs.rmSync(currentPath, { recursive: true, force: true })
        fs.renameSync(oldPath, currentPath)
        Logger.log(`Directory renamed: ${currentPath}`)
        await promptRestart()
      }
    } catch (error: any) {
      Logger.error('Error updating userData path:', error)
      dialog.showErrorBox('错误', `更新用户数据目录时发生错误: ${error.message}`)
    }
  } else {
    Logger.log('userData path does not need to be updated')
  }
}

async function createWindowsBatFile(oldPath: string, currentPath: string): Promise<string> {
  const batPath = path.join(app.getPath('temp'), 'rename_userdata.bat')
  const appPath = app.getPath('exe')
  const batContent = `
@echo off
timeout /t 2 /nobreak
rmdir /s /q "${currentPath}"
rename "${oldPath}" "${path.basename(currentPath)}"
start "" "${appPath}"
del "%~f0"
  `
  fs.writeFileSync(batPath, batContent)
  return batPath
}

async function promptRestartAndExecute(batPath: string) {
  await dialog.showMessageBox({
    type: 'info',
    title: '应用需要重启',
    message: '用户数据目录将在重启后更新。请重启应用以应用更改。',
    buttons: ['手动重启']
  })

  // 执行 bat 文件
  spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore'
  })

  app.exit(0)
}

async function promptRestart() {
  await dialog.showMessageBox({
    type: 'info',
    title: '应用需要重启',
    message: '用户数据目录已更新。请重启应用以应用更改。',
    buttons: ['重启']
  })

  app.relaunch()
  app.exit(0)
}

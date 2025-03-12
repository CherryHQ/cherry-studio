const fs = require('fs')
const path = require('path')
const os = require('os')
let rimraf

/**
 * 只清除样式相关缓存，不影响用户数据和配置
 */
function cleanupSettings() {
  try {
    // 定位应用数据位置
    const appName = 'Cherry Studio'
    const appData =
      process.env.APPDATA ||
      (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : path.join(os.homedir(), '.config'))

    const appDataPath = path.join(appData, appName)
    console.log(`应用数据路径: ${appDataPath}`)

    // 只清除样式相关缓存文件夹
    const cachePaths = [
      path.join(appDataPath, 'Cache'),
      path.join(appDataPath, 'Code Cache'),
      path.join(appDataPath, 'GPUCache')
    ]

    // 检查和清除缓存路径
    const cleanupPromises = cachePaths.map((cachePath) => {
      return new Promise((resolve) => {
        if (fs.existsSync(cachePath)) {
          console.log(`清除样式缓存路径: ${cachePath}`)
          try {
            rimraf.sync(cachePath)
            console.log(`成功清除: ${cachePath}`)
          } catch (e) {
            console.error(`无法清除 ${cachePath}:`, e)
          }
        } else {
          console.log(`路径不存在: ${cachePath}`)
        }
        resolve()
      })
    })

    Promise.all(cleanupPromises).then(() => {
      console.log('样式缓存清除完成')
    })

    // 不清除用户数据和设置
  } catch (error) {
    console.error('清理设置时出错:', error)
  }
}

// 确保 rimraf 可用
// 如果 rimraf 不可用，自动安装
try {
  rimraf = require('rimraf')
} catch (e) {
  console.log('正在安装 rimraf...')
  const { execSync } = require('child_process')
  execSync('npm install rimraf --no-save')
  rimraf = require('rimraf')
}

cleanupSettings()

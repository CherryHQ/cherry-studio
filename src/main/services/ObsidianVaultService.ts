import { loggerService } from '@logger'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('ObsidianVaultService')
interface VaultInfo {
  path: string
  name: string
}

interface FileInfo {
  path: string
  type: 'folder' | 'markdown'
  name: string
}

class ObsidianVaultService {
  private obsidianConfigPath: string

  constructor() {
    // 根据操作系统获取Obsidian配置文件路径
    if (process.platform === 'win32') {
      this.obsidianConfigPath = path.join(app.getPath('appData'), 'obsidian', 'obsidian.json')
    } else if (process.platform === 'darwin') {
      this.obsidianConfigPath = path.join(
        app.getPath('home'),
        'Library',
        'Application Support',
        'obsidian',
        'obsidian.json'
      )
    } else {
      // Linux
      this.obsidianConfigPath = this.resolveLinuxObsidianConfigPath()
      logger.debug(`Resolved Obsidian config path (linux): ${this.obsidianConfigPath}`)
    }
  }

  /**
   * 获取所有的Obsidian Vault
   */
  getVaults(): VaultInfo[] {
    try {
      if (!fs.existsSync(this.obsidianConfigPath)) {
        return []
      }

      const configContent = fs.readFileSync(this.obsidianConfigPath, 'utf8')
      const config = JSON.parse(configContent)

      if (!config.vaults) {
        return []
      }

      return Object.entries(config.vaults).map(([, vault]: [string, any]) => ({
        path: vault.path,
        name: vault.name || path.basename(vault.path)
      }))
    } catch (error) {
      logger.error('Failed to get Obsidian Vault:', error as Error)
      return []
    }
  }

  /**
   * 获取Vault中的文件夹和Markdown文件结构
   */
  getVaultStructure(vaultPath: string): FileInfo[] {
    const results: FileInfo[] = []

    try {
      // 检查vault路径是否存在
      if (!fs.existsSync(vaultPath)) {
        logger.error(`Vault path does not exist: ${vaultPath}`)
        return []
      }

      // 检查是否是目录
      const stats = fs.statSync(vaultPath)
      if (!stats.isDirectory()) {
        logger.error(`Vault path is not a directory: ${vaultPath}`)
        return []
      }

      this.traverseDirectory(vaultPath, '', results)
    } catch (error) {
      logger.error('Failed to read Vault folder structure:', error as Error)
    }

    return results
  }

  /**
   * 递归遍历目录获取所有文件夹和Markdown文件
   */
  private traverseDirectory(dirPath: string, relativePath: string, results: FileInfo[]) {
    try {
      // 首先添加当前文件夹
      if (relativePath) {
        results.push({
          path: relativePath,
          type: 'folder',
          name: path.basename(relativePath)
        })
      }

      // 确保目录存在且可访问
      if (!fs.existsSync(dirPath)) {
        logger.error(`Directory does not exist: ${dirPath}`)
        return
      }

      let items
      try {
        items = fs.readdirSync(dirPath, { withFileTypes: true })
      } catch (err) {
        logger.error(`Failed to read directory ${dirPath}:`, err as Error)
        return
      }

      for (const item of items) {
        // 忽略以.开头的隐藏文件夹和文件
        if (item.name.startsWith('.')) {
          continue
        }

        const newRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name
        const fullPath = path.join(dirPath, item.name)

        if (item.isDirectory()) {
          this.traverseDirectory(fullPath, newRelativePath, results)
        } else if (item.isFile() && item.name.endsWith('.md')) {
          // 收集.md文件
          results.push({
            path: newRelativePath,
            type: 'markdown',
            name: item.name
          })
        }
      }
    } catch (error) {
      logger.error(`Failed to traverse directory ${dirPath}:`, error as Error)
    }
  }

  /**
   * 获取指定Vault的文件夹和Markdown文件结构
   * @param vaultName vault名称
   */
  getFilesByVaultName(vaultName: string): FileInfo[] {
    try {
      const vaults = this.getVaults()
      const vault = vaults.find((v) => v.name === vaultName)

      if (!vault) {
        logger.error(`Vault not found: ${vaultName}`)
        return []
      }

      logger.debug(`Get Vault file structure: ${vault.name} ${vault.path}`)
      return this.getVaultStructure(vault.path)
    } catch (error) {
      logger.error('Failed to get Vault file structure:', error as Error)
      return []
    }
  }

  /**
   * 在 Linux 下解析 Obsidian 配置文件路径，兼容多种安装方式。
   * 优先返回第一个存在的路径；若均不存在，则返回 XDG 默认路径。
   */
  private resolveLinuxObsidianConfigPath(): string {
    const home = app.getPath('home')
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config')

    // 常见目录名与文件名大小写差异做兼容
    const configDirs = ['obsidian', 'Obsidian']
    const fileNames = ['obsidian.json', 'Obsidian.json']

    const candidates: string[] = []

    // 1) AppImage/DEB（XDG 标准路径）
    for (const dir of configDirs) {
      for (const file of fileNames) {
        candidates.push(path.join(xdgConfigHome, dir, file))
      }
    }

    // 2) Snap 安装：
    // - 常见：~/snap/obsidian/current/.config/obsidian/obsidian.json
    // - 兼容：~/snap/obsidian/common/.config/obsidian/obsidian.json
    for (const dir of configDirs) {
      for (const file of fileNames) {
        candidates.push(path.join(home, 'snap', 'obsidian', 'current', '.config', dir, file))
        candidates.push(path.join(home, 'snap', 'obsidian', 'common', '.config', dir, file))
      }
    }

    // 3) Flatpak 安装：~/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json
    for (const dir of configDirs) {
      for (const file of fileNames) {
        candidates.push(path.join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', dir, file))
      }
    }

    const existing = candidates.find((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })

    if (existing) return existing

    return path.join(xdgConfigHome, 'obsidian', 'obsidian.json')
  }
}

export default ObsidianVaultService

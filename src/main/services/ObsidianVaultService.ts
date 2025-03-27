import { app } from 'electron'
import fs from 'fs'
import path from 'path'

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
      this.obsidianConfigPath = path.join(app.getPath('home'), '.config', 'obsidian', 'obsidian.json')
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
      console.error('获取Obsidian Vault失败:', error)
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
        console.error('Vault路径不存在:', vaultPath)
        return []
      }

      // 检查是否是目录
      const stats = fs.statSync(vaultPath)
      if (!stats.isDirectory()) {
        console.error('Vault路径不是一个目录:', vaultPath)
        return []
      }

      this.traverseDirectory(vaultPath, '', results)
    } catch (error) {
      console.error('读取Vault文件夹结构失败:', error)
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
        console.error('目录不存在:', dirPath)
        return
      }

      let items
      try {
        items = fs.readdirSync(dirPath, { withFileTypes: true })
      } catch (err) {
        console.error(`无法读取目录 ${dirPath}:`, err)
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
      console.error(`遍历目录出错 ${dirPath}:`, error)
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
        console.error('未找到指定名称的Vault:', vaultName)
        return []
      }

      console.log('获取Vault文件结构:', vault.name, vault.path)
      return this.getVaultStructure(vault.path)
    } catch (error) {
      console.error('获取Vault文件结构时发生错误:', error)
      return []
    }
  }
}

export default ObsidianVaultService

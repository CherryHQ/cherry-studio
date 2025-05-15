import { arch, cpus, platform, release, totalmem } from 'node:os'

export class SystemInfoService {
  // 获取操作系统基本信息
  public static getOsInfo() {
    // 使用基础OS信息
    return {
      os: platform(),
      version: release(),
      architecture: arch()
    }
  }

  public static getHardwareInfo() {
    const procInfo = cpus()
    // 1GB = 2^30 bytes
    const GB_SIZE = 1073741824

    // 防止虚拟环境出问题...
    if (!procInfo || procInfo.length === 0) {
      return {
        cpuName: '信息不可用',
        coreCount: 0,
        ram: '未知'
      }
    }

    // 内存精确到小数点后1位即可
    const memGB = (totalmem() / GB_SIZE).toFixed(1)

    return {
      cpuName: procInfo[0].model.replace(/\s+/g, ' ').trim(),
      coreCount: procInfo.length,
      ram: `${memGB}GB`
    }
  }
}

export default SystemInfoService

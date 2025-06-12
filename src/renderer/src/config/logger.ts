import Logger from 'electron-log/renderer'

// 设置渲染进程的日志级别
Logger.transports.console.level = 'info'

export default Logger

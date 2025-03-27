import log from 'electron-log'

// 配置日志文件路径
log.transports.file.resolvePathFn = () => process.env.NODE_ENV === 'development' 
  ? 'logs/main.log'
  : `${process.env.APPDATA || process.env.HOME}/.cherry-studio/logs/main.log`

// 配置日志级别
log.transports.file.level = 'info'
log.transports.console.level = 'info'

// 配置日志格式
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.transports.console.format = '[{level}] {text}'

export default log 
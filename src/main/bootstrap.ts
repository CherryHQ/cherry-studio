import { initAppDataDir } from './utils/file'

process.env.NODE_ENV !== 'development' && initAppDataDir()

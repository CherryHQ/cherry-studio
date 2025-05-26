import fs from 'node:fs'

export default class FileService {
  public static async readFile(_: Electron.IpcMainInvokeEvent, path: string) {
    return fs.promises.readFile(path, 'utf8')
  }
}

import fs from 'node:fs'

export default class FileService {
  public static async readFile(_: Electron.IpcMainInvokeEvent, path: string, encoding?: BufferEncoding) {
    // 如果指定了编码，则返回字符串，否则返回二进制数据
    if (encoding) {
      return fs.readFileSync(path, encoding)
    } else {
      return fs.readFileSync(path)
    }
  }
}

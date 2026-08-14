declare namespace Nutstore {
  export interface FileStat {
    path: string
    basename: string
    isDir: boolean
  }

  type MaybePromise<T> = Promise<T> | T

  export interface Fs {
    ls: (path: string) => MaybePromise<FileStat[]>
    mkdirs: (path: string) => Promise<void>
  }
}

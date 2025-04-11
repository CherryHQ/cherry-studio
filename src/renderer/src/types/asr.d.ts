interface ASRServerAPI {
  startServer: () => Promise<{ success: boolean; pid?: number; error?: string }>
  stopServer: (pid: number) => Promise<{ success: boolean; error?: string }>
}

interface Window {
  api: {
    asrServer: ASRServerAPI
    // 其他API...
    [key: string]: any
  }
}

import { BrowserWindow } from 'electron'

/**
 * Service for capturing HTML page content
 */
export class PageCaptureService {
  private static instance: PageCaptureService

  public static getInstance(): PageCaptureService {
    if (!PageCaptureService.instance) {
      PageCaptureService.instance = new PageCaptureService()
    }
    return PageCaptureService.instance
  }

  /**
   * Convert HTML content to PNG image
   * @param html - HTML content to convert
   * @param width - Optional initial window width (default: 1200)
   * @param height - Optional initial window height (default: 800)
   * @returns Base64 encoded PNG image data
   */
  public async captureHtmlToPng(
    _: Electron.IpcMainInvokeEvent,
    html: string,
    width = 1200,
    height = 800
  ): Promise<string> {
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: {
        offscreen: true,
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    try {
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
      await win.loadURL(dataUrl)

      // Wait for page to fully load
      await win.webContents.executeJavaScript(
        'new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", () => r(), { once: true }); })'
      )

      // Get actual content dimensions
      const { contentWidth, contentHeight } = await win.webContents.executeJavaScript(
        '(() => { const b = document.body; const e = document.documentElement; const w = Math.max(b.scrollWidth, e.scrollWidth, b.clientWidth, e.clientWidth); const h = Math.max(b.scrollHeight, e.scrollHeight, b.clientHeight, e.clientHeight); return { contentWidth: w, contentHeight: h }; })()'
      )

      // Set window size to content dimensions but not exceeding max limit
      const MAX = 32768
      const targetW = Math.min(contentWidth || width, MAX)
      const targetH = Math.min(contentHeight || height, MAX)
      win.setContentSize(targetW, targetH)

      // Capture page and convert to PNG
      const image = await win.webContents.capturePage()
      const png = image.toPNG()
      return Buffer.from(png).toString('base64')
    } finally {
      win.destroy()
    }
  }
}

export const pageCaptureService = PageCaptureService.getInstance()

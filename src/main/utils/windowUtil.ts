import { BrowserWindow } from 'electron'

function isTilingWindowManager() {
  if (process.platform === 'darwin') {
    return false
  }

  if (process.platform !== 'linux') {
    return true
  }

  const desktopEnv = process.env.XDG_CURRENT_DESKTOP?.toLowerCase()
  const tilingSystems = ['hyprland', 'i3', 'sway', 'bspwm', 'dwm', 'awesome', 'qtile', 'herbstluftwm', 'xmonad']

  return tilingSystems.some((system) => desktopEnv?.includes(system))
}

export const replaceDevtoolsFont = (browserWindow: BrowserWindow) => {
  if (process.platform === 'win32') {
    browserWindow.webContents.on('devtools-opened', () => {
      const css = `
        :root {
            --sys-color-base: var(--ref-palette-neutral100);
            --source-code-font-family: consolas;
            --source-code-font-size: 12px;
            --monospace-font-family: consolas;
            --monospace-font-size: 12px;
            --default-font-family: system-ui, sans-serif;
            --default-font-size: 12px;
        }
        .-theme-with-dark-background {
            --sys-color-base: var(--ref-palette-secondary25);
        }
        body {
            --default-font-family: system-ui,sans-serif;
        }`

      browserWindow.webContents.devToolsWebContents?.executeJavaScript(`
        const overriddenStyle = document.createElement('style');
        overriddenStyle.innerHTML = '${css.replaceAll('\n', ' ')}';
        document.body.append(overriddenStyle);
        document.body.classList.remove('platform-windows');`)
    })
  }
}

export { isTilingWindowManager }

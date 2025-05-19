import { BrowserWindow } from 'electron'

import { isDev, isWin } from '../constant'

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

//see: https://github.com/electron/electron/issues/42055#issuecomment-2449365647
export const replaceDevtoolsFont = (browserWindow: BrowserWindow) => {
  //only for windows and dev, don't do this in production to avoid performance issues
  if (isWin && isDev) {
    browserWindow.webContents.on('devtools-opened', () => {
      const css = `
        :root {
            --sys-color-base: var(--ref-palette-neutral100);
            --source-code-font-family: consolas !important;
            --source-code-font-size: 12px;
            --monospace-font-family: consolas !important;
            --monospace-font-size: 12px;
            --default-font-family: system-ui, sans-serif;
            --default-font-size: 12px;
            --ref-palette-neutral99: #ffffffff;
        }
        .theme-with-dark-background {
            --sys-color-base: var(--ref-palette-secondary25);
        }
        body {
            --default-font-family: system-ui, sans-serif;
        }
    `
      browserWindow.webContents.devToolsWebContents?.executeJavaScript(`
        const overriddenStyle = document.createElement('style');
        overriddenStyle.innerHTML = '${css.replaceAll('\n', ' ')}';
        document.body.append(overriddenStyle);
        document.querySelectorAll('.platform-windows').forEach(el => el.classList.remove('platform-windows'));
        addStyleToAutoComplete();
        const observer = new MutationObserver((mutationList, observer) => {
            for (const mutation of mutationList) {
                if (mutation.type === 'childList') {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const item = mutation.addedNodes[i];
                        if (item.classList.contains('editor-tooltip-host')) {
                            addStyleToAutoComplete();
                        }
                    }
                }
            }
        });
        observer.observe(document.body, {childList: true});
        function addStyleToAutoComplete() {
            document.querySelectorAll('.editor-tooltip-host').forEach(element => {
                if (element.shadowRoot.querySelectorAll('[data-key="overridden-dev-tools-font"]').length === 0) {
                    const overriddenStyle = document.createElement('style');
                    overriddenStyle.setAttribute('data-key', 'overridden-dev-tools-font');
                    overriddenStyle.innerHTML = '.cm-tooltip-autocomplete ul[role=listbox] {font-family: consolas !important;}';
                    element.shadowRoot.append(overriddenStyle);
                }
            });
        }
    `)
    })
  }
}

export { isTilingWindowManager }

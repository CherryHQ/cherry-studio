export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
export const isDev = process.env.NODE_ENV === 'development'
export const isPortable = isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env

export const PRINT_HTML_TEMPLATE = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>{{filename}}</title>
          <style>
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            /* Color variables */
            {{colorCss}}
            /* Font variables */
            {{fontCss}}
            /* Richtext styles */
            {{richtextCss}}
          </style>
        </head>
        <body theme-mode="light" os=${isMac ? 'mac' : isWin ? 'windows' : 'linux'}>
          <div id="root">
            <div class="tiptap">{{content}}</div>
          </div>
        </body>
        </html>
      `

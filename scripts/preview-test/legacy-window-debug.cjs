const fs = require('node:fs')
const { setTimeout: sleep } = require('node:timers/promises')
async function run() {
  const messages = []
  for (let tries = 0; tries < 40; tries++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:49239/json/list')).json()
      const page = targets.find(({ type, url }) => type === 'page' && /renderer\/index\.html/.test(url))
      if (!page) {
        await sleep(500)
        continue
      }
      const socket = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve)
        socket.addEventListener('error', reject)
      })
      socket.addEventListener('message', ({ data }) => {
        const m = JSON.parse(data)
        if (m.method === 'Runtime.exceptionThrown')
          messages.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
        if (m.id === 2) messages.push(m.result?.result?.value)
      })
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
      socket.send(
        JSON.stringify({
          id: 2,
          method: 'Runtime.evaluate',
          params: {
            expression:
              "JSON.stringify({text: document.body?.innerText.slice(0,250), buttons:[...document.querySelectorAll('button[aria-label]')].slice(-10).map(b=>b.getAttribute('aria-label')),html:document.documentElement.outerHTML.includes('app-loading')})",
            returnByValue: true
          }
        })
      )
      await sleep(1500)
      socket.close()
      break
    } catch (error) {
      messages.push(error.message)
      await sleep(500)
    }
  }
  fs.writeFileSync('prerequisite-renderer-diagnostic.json', JSON.stringify(messages, null, 2))
}
run().catch((e) => console.error(e))

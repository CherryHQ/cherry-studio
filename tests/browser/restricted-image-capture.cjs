/** Real-Chrome regression probe. Run: CHROME_PATH=/usr/bin/google-chrome node tests/browser/restricted-image-capture.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('@playwright/test')
const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite'))] }))

const repo = path.resolve(__dirname, '../..')
const image = fs.readFileSync(path.join(repo, 'src/renderer/utils/image.ts'), 'utf8')
const view = fs.readFileSync(path.join(repo, 'src/renderer/components/chat/HtmlArtifactView.tsx'), 'utf8')
// Bundle the actual helper and actual component preparation, not test reimplementations.
const helper = image.slice(
  image.indexOf('export interface CaptureScrollableIframeOptions'),
  image.indexOf('export const captureScrollableIframeAsBlob')
)
const start = view.indexOf('    const prepare = async () => {', view.indexOf('// Image export:'))
const preparation = view.slice(start, view.indexOf('    const onPrepare', start))
assert.ok(start > 0 && preparation.includes('restrictToLocalResources: true'))
const simpleFilterStart = image.indexOf('filter: (node: Node)', image.indexOf('export async function captureElement'))
const simpleFilter = image.slice(simpleFilterStart, image.indexOf('\n      })', simpleFilterStart))
assert.ok(simpleFilterStart > 0)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restricted-image-'))
const bundle = path.join(tmp, 'probe.js')
const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
esbuild.buildSync({
  stdin: {
    contents: `import * as library from 'html-to-image';
const loadHtmlToImage=async()=>library;
const logger={verbose(){},error(){}};
const TRANSPARENT_IMAGE_PLACEHOLDER=${JSON.stringify(placeholder)};
${helper}
window.probe=async(root,iframe,forceFailure,filterHidden)=>{
const iframeRef={current:iframe};
${preparation}
let restore;
const original=iframe.contentWindow.requestAnimationFrame;
if(forceFailure) iframe.contentWindow.requestAnimationFrame=()=>{throw new Error('forced capture failure')};
try {
restore=await prepare();
const HTML_ARTIFACT_ATTRIBUTE='data-html-artifact';
const simpleOptions={${simpleFilter}};
const canvas=await library.toCanvas(root,{fontEmbedCSS:'',...(filterHidden?{filter:n=>!(n instanceof HTMLElement)||getComputedStyle(n).display!=='none'}:simpleOptions)});
return {ok:true,png:canvas.toDataURL()};
}catch(e){return {ok:false,error:String(e)}}finally{restore?.();iframe.contentWindow.requestAnimationFrame=original;}
};`,
    resolveDir: repo,
    loader: 'ts'
  },
  bundle: true,
  format: 'iife',
  outfile: bundle
})

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--no-sandbox']
  })
  try {
    const cases = [
      'svg',
      'xlink',
      'forced failure',
      'nested srcdoc',
      'same-origin iframe',
      'shadow',
      'pseudo content',
      'pseudo background',
      'quoted paren url',
      'style @import',
      'style font-face used',
      'img srcset remote',
      'picture source srcset',
      'srcset data comma',
      'nested data svg',
      'video poster remote',
      'safe content'
    ]
    for (const name of cases)
      for (const filterHidden of [true, false]) {
        const page = await browser.newPage()
        const requests = []
        await page.route('https://example.com/**', (route) => {
          requests.push(route.request().url())
          return route.fulfill({ status: 404, body: '' })
        })
        await page.setContent(
          '<main id="root" style="width:400px;height:200px"><iframe sandbox="allow-same-origin" style="width:350px;height:150px"></iframe></main>'
        )
        await page.addScriptTag({ path: bundle })
        await page.evaluate(
          ({ name, filterHidden, placeholder }) => {
            const remote = `https://example.com/${encodeURIComponent(name)}/${filterHidden}/collect?secret=VALUE`
            const contents = {
              svg: `<div><svg width="10" height="10"><image href="${remote}"/></svg></div>`,
              xlink: `<svg width="10" height="10" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="${remote}"/></svg>`,
              'forced failure': `<svg><image href="${remote}"/></svg>`,
              'nested srcdoc': `<iframe srcdoc="&lt;img src='${remote}'&gt;"></iframe>`,
              'same-origin iframe': '<iframe></iframe>',
              shadow: '<div id="host"></div>',
              'pseudo content': `<style>div::before{content:url('${remote}')}</style><div>hello</div>`,
              'pseudo background': `<style>div::after{content:'';background-image:url('${remote}');display:block;width:20px;height:20px}</style><div>hello</div>`,
              'quoted paren url': `<style>div{background-image:url('${remote})b.png');width:20px;height:20px}</style><div>hello</div>`,
              'style @import': `<style>@import url('${remote}');</style><div>hello</div>`,
              'style font-face used': `<style>@font-face{font-family:BypassProbe;src:url('${remote}')}</style><div style="font-family:BypassProbe">hello</div>`,
              'img srcset remote': `<img src="data:," srcset="${remote} 1x">`,
              'picture source srcset': `<picture><source srcset="${remote} 1x"><img src="data:,"></picture>`,
              'srcset data comma': `<img srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw== 1x, ${remote} 2x">`,
              'nested data svg': `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><image href='${remote}'/></svg>`)}">`,
              'video poster remote': `<video poster="${remote}"></video>`,
              'safe content': `<main style="background:#fff;color:#000">Safe text<img src="${placeholder}"></main>`
            }
            document.querySelector('iframe').srcdoc =
              `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: file:; style-src 'unsafe-inline'">${contents[name]}`
          },
          { name, filterHidden, placeholder }
        )
        await page.waitForTimeout(100)
        await page.evaluate(
          ({ name }) => {
            const doc = document.querySelector('iframe').contentDocument
            if (name === 'shadow')
              doc.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML =
                '<svg><image href="https://example.com/shadow-resource"/></svg>'
            if (name === 'same-origin iframe')
              doc.querySelector('iframe').contentDocument.body.innerHTML =
                '<svg><image href="https://example.com/nested-resource"/></svg>'
          },
          { name }
        )
        const before = requests.length
        const result = await page.evaluate(
          ({ name, filterHidden }) =>
            window.probe(
              document.querySelector('#root'),
              document.querySelector('iframe'),
              name === 'forced failure',
              filterHidden
            ),
          { name, filterHidden }
        )
        assert.equal(before, 0, `${name}: preview made a request`)
        assert.deepEqual(requests, [], `${name}: export made a request`)
        const safe = [
          'svg',
          'xlink',
          'quoted paren url',
          'style @import',
          'style font-face used',
          'img srcset remote',
          'picture source srcset',
          'srcset data comma',
          'nested data svg',
          'video poster remote',
          'safe content'
        ].includes(name)
        assert.equal(result.ok, safe, `${name}: ${result.error}`)
        if (safe) {
          assert.equal(await page.locator('iframe').evaluate((el) => el.style.display), '')
          assert.equal(await page.locator('#root > img').count(), 0)
          fs.writeFileSync(
            path.join(tmp, `${name}-${filterHidden}.png`),
            Buffer.from(result.png.split(',')[1], 'base64')
          )
        }
        console.log(`PASS ${name}, outer filter=${filterHidden}`)
        await page.close()
      }
    console.log(`Rendered evidence: ${tmp}`)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

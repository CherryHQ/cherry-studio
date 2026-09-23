const { createRequire } = require('node:module')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const req = createRequire(path.join(root, 'package.json'))
const { _electron, expect } = req('@playwright/test')
const fs = require('node:fs')
const http = require('node:http')

;(async () => {
  const profile = fs.mkdtempSync('/tmp/cherry-parameters-qa-')
  const override = path.join(profile, 'Runtime/provider-registry-override')
  fs.mkdirSync(override, { recursive: true })
  const models = JSON.parse(fs.readFileSync(path.join(root, 'packages/provider-registry/data/models.json'), 'utf8'))
  for (const model of models.models) delete model.imageGeneration
  const providerModels = JSON.parse(
    fs.readFileSync(path.join(root, 'packages/provider-registry/data/provider-models.json'), 'utf8')
  )
  for (const model of providerModels.overrides) delete model.imageGeneration
  fs.writeFileSync(path.join(override, 'models.json'), JSON.stringify(models))
  fs.writeFileSync(path.join(override, 'provider-models.json'), JSON.stringify(providerModels))
  fs.writeFileSync(
    path.join(override, 'manifest.json'),
    JSON.stringify({
      minAppVersion: '2.1.2',
      sourceAppVersion: '2.1.2',
      revision: 999999,
      schemaVersion: 2,
      files: { 'models.json': models.version, 'provider-models.json': providerModels.version }
    })
  )

  const png = await req('sharp')({ create: { width: 256, height: 144, channels: 3, background: '#3377cc' } })
    .png()
    .toBuffer()
  const requests = []
  const server = http.createServer(async (q, r) => {
    try {
      const parts = []
      for await (const c of q) parts.push(c)
      const bytes = Buffer.concat(parts)
      let body
      if (q.headers['content-type']?.includes('multipart')) {
        const form = await new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-type': q.headers['content-type'] },
          body: bytes
        }).formData()
        body = Object.fromEntries([...form].map(([k, v]) => [k, typeof v === 'string' ? v : 'image-file']))
      } else body = JSON.parse(bytes)
      requests.push({ url: q.url, body })
      r.writeHead(200, { 'Content-Type': 'application/json' })
      if (q.url.includes(':generateContent')) {
        r.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }]
                },
                finishReason: 'STOP'
              }
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
          })
        )
        return
      }

      r.end(
        JSON.stringify({
          created: 1,
          data: Array.from({ length: Number(body.n || 1) }, () => ({ b64_json: png.toString('base64') }))
        })
      )
    } catch (e) {
      r.writeHead(500)
      r.end(String(e))
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  let app
  const launch = async () => {
    app = await _electron.launch({
      executablePath:
        process.env.CHERRY_IMAGE_TEST_EXECUTABLE ||
        root + '/dist/image-workflow-parameters/mac-arm64/Cherry Studio Images.app/Contents/MacOS/Cherry Studio Images',
      args: ['--user-data-dir=' + profile],
      timeout: 60000
    })
    const actual = await app.evaluate(({ app }) => app.getPath('userData'))
    if (fs.realpathSync(actual) !== fs.realpathSync(profile)) throw Error('Wrong profile')
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.api?.dataApi)
    return page
  }
  const stop = async () => {
    await app.evaluate(({ app }) => app.exit(0))
    await app.close().catch(() => {})
    app = undefined
  }
  try {
    let page = await launch()
    const pid = await page.evaluate(async (port) => {
      const data = async (method, path, body) => {
        const r = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
        if (r.error) throw Error(r.error.message)
        return r.data
      }
      await window.api.preference.setMultiple({
        'app.language': 'zh-CN',
        'app.onboarding.provider_setup.status': 'skipped',
        'feature.quick_assistant.enabled': false,
        'feature.selection.enabled': false
      })
      const id = 'parameters-' + Date.now()
      await data('POST', '/providers', {
        providerId: id,
        name: '图片参数验收',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: Object.fromEntries(
          ['openai-chat-completions', 'openai-responses', 'openai-image-generation', 'openai-image-edit'].map((k) => [
            k,
            { adapterFamily: 'openai-compatible', baseUrl: 'http://127.0.0.1:' + port + '/v1' }
          ])
        ),
        apiKeys: [{ id: 'qa', key: 'local-fixture-only', isEnabled: true }]
      })
      await data('PATCH', '/providers/' + id, { isEnabled: true })
      await data('POST', '/models', [
        {
          providerId: id,
          modelId: 'custom-image-model',
          name: '图片参数测试模型',
          endpointTypes: ['openai-image-generation', 'openai-image-edit'],
          capabilities: ['image-generation'],
          inputModalities: ['image'],
          outputModalities: ['image']
        }
      ])
      return id
    }, server.address().port)
    const open = async () => {
      await page.evaluate(
        (id) => window.api.ipcApi.request('navigation.open_route_in_main', { path: '/settings/provider?id=' + id }),
        pid
      )
      for (const name of ['同意并继续', 'Accept and Continue']) {
        const b = page.getByRole('button', { name, exact: true })
        if (await b.first().isVisible()) await b.first().click()
      }
      await page.getByText('图片参数测试模型', { exact: true }).waitFor()
      await page.getByRole('button', { name: '设置', exact: true }).last().click()
      const section = page.getByRole('region', { name: '图片参数', exact: true })
      await section.waitFor()
      return section
    }
    let section = await open()
    expect(
      await page.getByRole('dialog').evaluate((dialog) => {
        const type = dialog.querySelector('[role="group"][aria-label="模型类型"]')
        const parameters = dialog.querySelector('section[aria-label="图片参数"]')
        return Boolean(
          type && parameters && type.compareDocumentPosition(parameters) & Node.DOCUMENT_POSITION_FOLLOWING
        )
      })
    ).toBe(true)
    const select = async (label, option) => {
      if (label === '图片模型预设') await section.getByRole('radio', { name: option, exact: true }).click()
      else
        await section
          .getByRole('group', { name: label, exact: true })
          .getByRole('button', { name: option, exact: true })
          .click()
    }
    await expect(section.getByRole('radio')).toHaveCount(4)
    await expect(section.getByRole('radio', { name: 'GPT Image', exact: true })).toBeChecked()
    await expect(section.getByRole('radio', { name: '默认', exact: true })).toHaveCount(0)
    await select('图片模型预设', 'GPT Image')
    await expect
      .poll(() =>
        page.evaluate(async (pid) => {
          const r = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'GET',
            path: '/models/' + pid + '::custom-image-model'
          })
          return {
            preset: r.data?.imageGenerationConfig?.preset,
            edit: Boolean(r.data?.imageGeneration?.modes?.edit)
          }
        }, pid)
      )
      .toEqual({ preset: 'gpt-image-2-5-sunburst', edit: true })
    console.log('UNCHANGED_DEFAULT_PRESET_PERSISTED_WITH_EDIT_SUPPORT')
    await expect(
      section.getByRole('group', { name: '画幅比例', exact: true }).getByRole('button', { name: '自动', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await select('画幅比例', '1:1')
    const quantity = section.getByRole('group', { name: '生成数量', exact: true })
    await expect(quantity.getByRole('spinbutton', { name: '生成数量', exact: true })).toHaveValue('1')
    await expect(quantity.getByLabel('最大生成数量', { exact: true })).toHaveValue('10')
    expect(
      await section.evaluate((element) => {
        const moderation = element.querySelector('[role="group"][aria-label="审核强度"]')
        const quantity = element.querySelector('[role="group"][aria-label="生成数量"]')
        const sizing = element.querySelector('details')?.parentElement
        return Boolean(
          moderation &&
          quantity &&
          moderation.compareDocumentPosition(quantity) & Node.DOCUMENT_POSITION_FOLLOWING &&
          sizing?.textContent.includes('预计 1024×1024')
        )
      })
    ).toBe(true)
    console.log('GROUPED_COUNT_AND_SIZE_PREVIEW_VERIFIED')
    await select('图片模型预设', 'Seedream')
    await expect(section.getByRole('combobox', { name: 'Seedream 5.0', exact: true })).toHaveCount(0)
    await select('图片模型预设', 'Nano Banana')
    await select('分辨率', '2K')
    await select('画幅比例', '16:9')
    await expect(section.getByText('2K · 16:9 · 预计 2752×1536', { exact: false })).toBeVisible()
    await select('图片模型预设', 'Grok Image')
    await select('分辨率', '2K')
    await select('画幅比例', '16:9')
    await expect(section.getByText(/预计/)).toHaveCount(0)
    console.log('NATIVE_SIZE_PREVIEWS_VERIFIED')
    await select('图片模型预设', 'GPT Image')
    await select('分辨率', '2K')
    const font = (element) => ({
      size: getComputedStyle(element).fontSize,
      weight: getComputedStyle(element).fontWeight
    })
    const typeFont = await page.getByRole('dialog').getByRole('button', { name: '图片', exact: true }).evaluate(font)
    const parameterFont = await section
      .getByRole('group', { name: '分辨率', exact: true })
      .getByRole('button', { name: '2K', exact: true })
      .evaluate(font)
    expect(parameterFont).toEqual(typeFont)
    console.log('TYPOGRAPHY_VERIFIED', JSON.stringify({ typeFont, parameterFont }))

    await select('画幅比例', '16:9')
    await select('质量', '最高')
    const qualityGroup = section.getByRole('group', { name: '质量', exact: true })
    await qualityGroup.getByRole('button', { name: '删除 超高', exact: true }).click()
    await qualityGroup.getByRole('textbox', { name: '质量 添加', exact: true }).fill('xhigh')
    await qualityGroup.getByRole('button', { name: '添加', exact: true }).click()
    await qualityGroup.getByRole('button', { name: '删除 超高', exact: true }).click()
    await select('输出格式', 'WEBP')
    await select('背景', '不透明')
    await select('审核强度', '低')
    await section.getByLabel('输出压缩率', { exact: true }).fill('70')
    await section.getByRole('spinbutton', { name: '生成数量', exact: true }).fill('2')
    await section.getByLabel('最大生成数量', { exact: true }).fill('3')
    await section.getByRole('tab', { name: '编辑', exact: true }).click()
    const modeBox = await section.getByRole('tablist').boundingBox()
    const inheritBox = await section.getByRole('switch', { name: '沿用生成配置' }).boundingBox()
    expect(Math.abs(modeBox.y + modeBox.height / 2 - (inheritBox.y + inheritBox.height / 2))).toBeLessThan(3)

    await page.screenshot({ path: '/tmp/cherry-image-compact-mode.png' })
    await section.getByRole('switch', { name: '沿用生成配置' }).click()
    await select('分辨率', '1K')
    await select('画幅比例', '1:1')
    await select('质量', '低')
    await select('输出格式', 'PNG')
    await select('背景', '透明')
    await section.getByRole('spinbutton', { name: '生成数量', exact: true }).fill('1')
    await expect(section.getByRole('button', { name: '保存模型属性' })).toHaveCount(0)
    await expect
      .poll(async () =>
        page.evaluate(async (pid) => {
          const r = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'GET',
            path: '/models/' + pid + '::custom-image-model'
          })
          return r.data?.imageGenerationConfig?.edit?.defaults
        }, pid)
      )
      .toMatchObject({ quality: 'low', outputFormat: 'png', numImages: 1 })
    await expect(section).toHaveAttribute('data-saving', 'false')
    console.log('UI_SAVED')
    await section.getByRole('tab', { name: '生成', exact: true }).click()
    await section.getByRole('group', { name: '分辨率', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/cherry-image-parameters-ui.png' })
    await stop()
    page = await launch()
    section = await open()
    await expect(
      section.getByRole('group', { name: '分辨率', exact: true }).getByRole('button', { name: '2K', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      section.getByRole('group', { name: '质量', exact: true }).getByRole('button', { name: '最高', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      section.getByRole('group', { name: '输出格式', exact: true }).getByRole('button', { name: 'WEBP', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await section.getByRole('tab', { name: '编辑', exact: true }).click()
    await expect(
      section.getByRole('group', { name: '质量', exact: true }).getByRole('button', { name: '低', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    console.log('RESTART_RETAINED')
    const saved = await page.evaluate(async (pid) => {
      const r = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'GET',
        path: '/models/' + pid + '::custom-image-model'
      })
      if (r.error) throw Error(r.error.message)
      return r.data.imageGenerationConfig
    }, pid)
    expect(saved.generate.defaults).toMatchObject({
      quality: 'max',
      imageResolution: '2K',
      aspectRatio: '16:9',
      outputFormat: 'webp',
      outputCompression: 70,
      numImages: 2
    })
    expect(saved.generate.options.quality).not.toContain('xhigh')
    expect(saved.edit.defaults).toMatchObject({
      quality: 'low',
      imageResolution: '1K',
      outputFormat: 'png',
      numImages: 1
    })
    for (const mode of ['generate', 'edit']) {
      const result = await page.evaluate(
        async ({ pid, mode, image }) => {
          const r = await window.api.ipcApi.request('ai.image.generate', {
            requestId: crypto.randomUUID(),
            payload: {
              uniqueModelId: pid + '::custom-image-model',
              prompt: 'A blue test rectangle',
              mode,
              paramValues: {},
              cleanupPolicy: 'manual',
              ...(mode === 'edit' ? { inputImages: [image] } : {})
            }
          })
          if (r.error) throw Error(JSON.stringify(r.error))
          return (r.data ?? r).files
        },
        { pid, mode, image: 'data:image/png;base64,' + png.toString('base64') }
      )
      expect(result.length).toBe(mode === 'generate' ? 2 : 1)
    }
    const generated = requests.filter((r) => r.url.endsWith('/generations'))
    expect(generated.reduce((n, r) => n + Number(r.body.n), 0)).toBe(2)
    for (const r of generated)
      expect(r.body).toMatchObject({
        model: 'custom-image-model',
        size: '2048x1152',
        quality: 'max',
        output_format: 'webp',
        output_compression: 70,
        background: 'opaque',
        moderation: 'low'
      })
    const edited = requests.find((r) => r.url.endsWith('/edits'))
    expect(edited.body).toMatchObject({
      model: 'custom-image-model',
      size: '1024x1024',
      quality: 'low',
      output_format: 'png',
      n: '1',
      background: 'transparent'
    })
    expect(edited.body).not.toHaveProperty('output_compression')
    await section.getByRole('tab', { name: '生成', exact: true }).click()
    const add = async (label, value) => {
      const group = section.getByRole('group', { name: label, exact: true })
      await group.getByRole('textbox', { name: label + ' 添加', exact: true }).fill(value)
      await group.getByRole('button', { name: '添加', exact: true }).click()
      await group.getByRole('button', { name: value, exact: true }).click()
    }
    await add('质量', 'custom-quality')
    await section
      .getByRole('group', { name: '质量', exact: true })
      .getByRole('button', { name: '编辑 custom-quality', exact: true })
      .click()
    await section.getByRole('textbox', { name: '质量 编辑', exact: true }).fill('custom-quality-v2')
    await section
      .getByRole('group', { name: '质量', exact: true })
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await add('分辨率', '6K')
    await select('画幅比例', '3:1')
    await section.locator('summary').filter({ hasText: '尺寸换算' }).click()
    await section.getByRole('switch', { name: '按最长边计算', exact: true }).click()
    await expect(section.getByText('6K · 3:1 · 预计 6144×2048', { exact: false })).toBeVisible()
    await section.getByRole('spinbutton', { name: '宽度', exact: true }).fill('6000')
    await section.getByRole('spinbutton', { name: '高度', exact: true }).fill('2000')
    await expect(section.getByRole('button', { name: '保存模型属性' })).toHaveCount(0)
    await expect
      .poll(async () =>
        page.evaluate(async (pid) => {
          const r = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'GET',
            path: '/models/' + pid + '::custom-image-model'
          })
          return r.data?.imageGenerationConfig?.generate?.canvases
        }, pid)
      )
      .toContainEqual({ resolution: '6K', aspectRatio: '3:1', size: '6000x2000' })
    await expect(section).toHaveAttribute('data-saving', 'false')
    await stop()
    page = await launch()
    section = await open()
    await expect(
      section
        .getByRole('group', { name: '质量', exact: true })
        .getByRole('button', { name: 'custom-quality-v2', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(section.getByText('6K · 3:1 · 预计 6000×2000', { exact: false })).toBeVisible()
    const customResult = await page.evaluate(async (pid) => {
      const r = await window.api.ipcApi.request('ai.image.generate', {
        requestId: crypto.randomUUID(),
        payload: {
          uniqueModelId: pid + '::custom-image-model',
          prompt: 'Custom settings fixture',
          mode: 'generate',
          paramValues: { numImages: 1 },
          cleanupPolicy: 'manual'
        }
      })
      if (r.error) throw Error(JSON.stringify(r.error))
      return (r.data ?? r).files
    }, pid)
    expect(customResult).toHaveLength(1)
    expect(requests.at(-1).body).toMatchObject({ quality: 'custom-quality-v2', size: '6000x2000', n: 1 })
    console.log('CUSTOM_OPTIONS_AND_DIMENSIONS_VERIFIED')

    const dmxFiles = await page.evaluate(
      async ({ port, image }) => {
        const data = async (method, path, body) => {
          const r = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
          if (r.error) throw Error(r.error.message)
          return r.data
        }
        const providerId = 'dmx-native-' + Date.now()
        await data('POST', '/providers', {
          providerId,
          presetProviderId: 'dmxapi',
          name: 'DMX native edit fixture',
          endpointConfigs: {
            'google-generate-content': { baseUrl: 'http://127.0.0.1:' + port + '/v1beta/' },
            'openai-chat-completions': { baseUrl: 'http://127.0.0.1:' + port + '/v1/' }
          },
          apiKeys: [{ id: 'native-test', key: 'local-fixture-only', isEnabled: true }]
        })
        await data('PATCH', '/providers/' + providerId, { isEnabled: true })
        const [model] = await data('POST', '/models', [
          {
            providerId,
            modelId: 'gemini-3.1-flash-image-ssvip',
            capabilities: ['image-generation'],
            endpointTypes: ['google-generate-content'],
            imageGenerationConfig: {
              preset: 'gemini-3-1-flash-image',
              generate: { defaults: { imageResolution: '2K', aspectRatio: '16:9' }, options: {} },
              edit: null
            }
          }
        ])
        const result = await window.api.ipcApi.request('ai.image.generate', {
          requestId: crypto.randomUUID(),
          payload: {
            uniqueModelId: model.id,
            mode: 'edit',
            prompt: 'Make the background blue',
            inputImages: [image],
            paramValues: {},
            cleanupPolicy: 'manual'
          }
        })
        if (result.error) throw Error(JSON.stringify(result.error))
        return (result.data ?? result).files
      },
      { port: server.address().port, image: 'data:image/png;base64,' + png.toString('base64') }
    )
    expect(dmxFiles).toHaveLength(1)
    expect(requests.at(-1).url).toContain('/v1beta/models/gemini-3.1-flash-image-ssvip:generateContent')
    expect(requests.at(-1).body.generationConfig.imageConfig).toMatchObject({ imageSize: '2K', aspectRatio: '16:9' })
    expect(JSON.stringify(requests.at(-1).body.contents)).toContain(png.toString('base64'))
    console.log('DMXAPI_NANO_EDIT_END_TO_END_VERIFIED')
    console.log('HTTP_DEFAULTS_VERIFIED', JSON.stringify(requests))
    fs.writeFileSync('/tmp/cherry-image-parameters-qa.json', JSON.stringify({ profile, saved, requests }, null, 2))
  } catch (e) {
    if (app) {
      const p = await app.firstWindow()
      console.log('FAIL_BODY', await p.locator('body').innerText())
      await p.screenshot({ path: '/tmp/cherry-image-parameters-failure.png' })
    }
    throw e
  } finally {
    if (app) await stop().catch(() => {})
    server.close()
  }
})().catch((e) => {
  console.error(e.stack)
  process.exitCode = 1
})

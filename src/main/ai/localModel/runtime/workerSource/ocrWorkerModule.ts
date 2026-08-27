/**
 * The OCR capability inside the worker: ppu-paddle-ocr, its service cache, and the one
 * request it answers. Registers itself into the core's `CAPABILITIES` table — see
 * `./workerCore.ts` for what a capability may contribute.
 */
export const ocrWorkerModuleSource = `
const paddleServices = new Map() // key: det|rec|dict -> Promise<PaddleOcrService>

function getPaddleService(modelPaths) {
  const key = modelPaths.detection + '|' + modelPaths.recognition + '|' + modelPaths.charactersDictionary
  return cachedResource(paddleServices, key, async () => {
    const { PaddleOcrService } = await getPpu()
    let sessionFallbackError = null
    const service = new PaddleOcrService({
      model: {
        detection: modelPaths.detection,
        recognition: modelPaths.recognition,
        charactersDictionary: modelPaths.charactersDictionary
      },
      session: {
        ...runtimeProfile.sessionOptions,
        onSessionFallback: (error) => {
          sessionFallbackError = sessionFallbackError || error
        }
      }
    })
    await service.initialize()
    if (sessionFallbackError) {
      try {
        await service.destroy()
      } catch (error) {
        postLog('warn', 'failed to dispose internally-fallen-back OCR service error=' + describeError(error))
      }
      throw new Error('OCR hardware session fell back internally to CPU', { cause: sessionFallbackError })
    }
    if (runtimeProfile.id !== 'cpu') {
      postLog('info', 'hardware provider active provider=' + runtimeProfile.id + ' runtime=ocr')
    }
    return service
  })
}

CAPABILITIES['ocr.recognize'] = {
  dispose: () => disposeCached(paddleServices),
  // Reading the image is request setup, not inference: a missing file must fail once
  // rather than be blamed on the hardware provider and retried on CPU.
  prepare: (msg) =>
    msg.source.kind === 'bytes' ? msg.source.imageBytes : require('node:fs').readFileSync(msg.source.imagePath),
  handle: async (msg, buffer) => {
    const service = await getPaddleService(msg.modelPaths)
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    const result = await service.recognize(arrayBuffer)
    // Normalized here so callers never branch on null: the engine reports no runs as
    // absent fields, and the protocol promises both.
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      payload: { text: result.text || '', lines: result.lines || [] }
    })
  }
}
`

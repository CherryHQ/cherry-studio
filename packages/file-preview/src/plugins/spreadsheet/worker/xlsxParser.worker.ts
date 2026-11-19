import type { XlsxParseRequest, XlsxParseResponse } from '../renderModel'
import { parseWorkbook } from './parseWorkbook'

/** Thin glue only. All logic lives in parseWorkbook, a testable pure function; keep business logic out of this file. */
self.onmessage = async (event: MessageEvent<XlsxParseRequest>) => {
  const { id, fileName, data } = event.data
  try {
    const model = await parseWorkbook(data, fileName)
    const transfers = Object.values(model.images).map((image) => image.data)
    self.postMessage({ id, ok: true, model } satisfies XlsxParseResponse, { transfer: transfers })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    } satisfies XlsxParseResponse)
  }
}

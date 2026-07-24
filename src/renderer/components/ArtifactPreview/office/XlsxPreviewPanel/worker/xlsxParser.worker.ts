import type { XlsxParseRequest, XlsxParseResponse } from '../renderModel'
import { parseWorkbook } from './parseWorkbook'

/** Thin glue only. All logic lives in parseWorkbook, a testable pure function; keep business logic out of this file. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<XlsxParseRequest>) => void) | null
  postMessage(message: XlsxParseResponse, transfer?: Transferable[]): void
}

scope.onmessage = async (event) => {
  const { id, fileName, data } = event.data
  try {
    const model = await parseWorkbook(data, fileName)
    const transfers = Object.values(model.images).map((image) => image.data)
    scope.postMessage({ id, ok: true, model }, transfers)
  } catch (error) {
    scope.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}

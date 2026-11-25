import ExcelJS from 'exceljs'

export type {
  Cell,
  CellFormulaValue,
  CellSharedFormulaValue,
  Color,
  Fill,
  ImageRange,
  Row,
  Workbook,
  Worksheet,
  WorksheetModel
} from 'exceljs'

export function createWorkbook(): ExcelJS.Workbook {
  return new ExcelJS.Workbook()
}

export async function readWorkbook(data: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = createWorkbook()
  await workbook.xlsx.load(data)
  return workbook
}

export async function readWorkbookForPreview(data: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = createWorkbook()
  const xlsx = workbook.xlsx as unknown as {
    parseWorkbook(stream: unknown): Promise<{ definedNames?: unknown[] }>
  }
  const parseWorkbook = xlsx.parseWorkbook.bind(xlsx)
  // Defined names are in workbook.xml, beyond ignoreNodes; expanding their ranges can exhaust memory.
  xlsx.parseWorkbook = async (stream) => ({ ...(await parseWorkbook(stream)), definedNames: [] })
  await workbook.xlsx.load(data, { ignoreNodes: ['mergeCells', 'dataValidations'] })
  return workbook
}

export async function writeWorkbook(workbook: ExcelJS.Workbook): Promise<Uint8Array<ArrayBuffer>> {
  // ExcelJS returns Buffer in Node and ArrayBuffer in browsers; normalize ownership and type.
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

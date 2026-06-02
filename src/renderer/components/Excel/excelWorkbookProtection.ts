import {
  CanceledError,
  CommandType,
  type ICommandInfo,
  IConfigService,
  type IDisposable,
  type IExecutionOptions,
  type Univer
} from '@univerjs/core'
import type { FUniver } from '@univerjs/core/facade'

const SHEETS_UI_CONFIG_KEY = 'sheets-ui.config'

const ALLOWED_WORKBOOK_VIEW_COMMANDS = new Set([
  'sheet.command.change-zoom-ratio',
  'sheet.command.scroll-to-cell',
  'sheet.command.scroll-view',
  'sheet.command.scroll-view-reset',
  'sheet.command.select-range',
  'sheet.command.set-table-filter',
  'sheet.command.set-scroll-relative',
  'sheet.command.set-worksheet-activate',
  'sheet.command.set-zoom-ratio'
])

const ALLOWED_WORKBOOK_VIEW_MUTATIONS = new Set(['sheet.mutation.set-table-filter'])

const PROTECTED_WORKBOOK_VIEW_COMMAND_PREFIXES = [
  'doc.command.',
  'sheet.command.',
  'slide.command.',
  'univer.command.redo',
  'univer.command.undo'
]

const PROTECTED_WORKBOOK_VIEW_OPERATIONS = new Set([
  'sheet.operation.set-activate-cell-edit',
  'sheet.operation.set-cell-edit-visible',
  'sheet.operation.set-cell-edit-visible-f2'
])

const isLocalFormulaMutation = (commandInfo: Readonly<ICommandInfo>, options?: IExecutionOptions) => {
  return options?.onlyLocal === true && commandInfo.id.startsWith('formula.mutation.')
}

export function configureExcelWorkbookReadOnly(univer: Univer) {
  univer
    .__getInjector()
    .get(IConfigService)
    .setConfig(
      SHEETS_UI_CONFIG_KEY,
      {
        disableEdit: true,
        clipboardConfig: {
          hidePasteOptions: true
        },
        footer: {
          addSheetButtonConfig: {
            show: false
          }
        }
      },
      { merge: true }
    )
}

export function shouldBlockExcelWorkbookCommand(
  commandInfo: Readonly<ICommandInfo>,
  options?: IExecutionOptions
): boolean {
  if (options?.fromChangeset) return false
  if (isLocalFormulaMutation(commandInfo, options)) return false
  if (ALLOWED_WORKBOOK_VIEW_MUTATIONS.has(commandInfo.id)) return false
  if (commandInfo.type === CommandType.MUTATION) return true
  if (PROTECTED_WORKBOOK_VIEW_OPERATIONS.has(commandInfo.id)) return true
  if (ALLOWED_WORKBOOK_VIEW_COMMANDS.has(commandInfo.id)) return false

  return PROTECTED_WORKBOOK_VIEW_COMMAND_PREFIXES.some((prefix) => commandInfo.id.startsWith(prefix))
}

export function installExcelWorkbookCommandGuard(univerAPI: Pick<FUniver, 'onBeforeCommandExecute'>): IDisposable {
  return univerAPI.onBeforeCommandExecute((commandInfo, options) => {
    if (shouldBlockExcelWorkbookCommand(commandInfo, options)) {
      throw new CanceledError()
    }
  })
}

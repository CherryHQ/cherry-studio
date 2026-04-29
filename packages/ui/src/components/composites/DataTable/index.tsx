import {
  type Cell,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  type Updater,
  useReactTable
} from '@tanstack/react-table'
import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import { Checkbox } from '../../primitives/checkbox'
import { RadioGroup, RadioGroupItem } from '../../primitives/radioGroup'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../primitives/table'

export type DataTableKey = React.Key

export type DataTableColumnMeta = {
  className?: string
  headerClassName?: string
  width?: number | string
  maxWidth?: number | string
  align?: 'left' | 'center' | 'right'
}

export type DataTableSelection<TData> = {
  type: 'single' | 'multiple'
  selectedRowKeys: DataTableKey[]
  onChange: (selectedRowKeys: DataTableKey[], selectedRows: TData[]) => void
  getCheckboxProps?: (record: TData) => {
    disabled?: boolean
    ariaLabel?: string
  }
  columnWidth?: number | string
}

export type DataTableProps<TData> = {
  data: TData[]
  columns: ColumnDef<TData, any>[]
  rowKey: keyof TData | ((record: TData) => DataTableKey)
  selection?: DataTableSelection<TData>
  headerLeft?: React.ReactNode
  headerRight?: React.ReactNode
  emptyText?: React.ReactNode
  maxHeight?: number | string
  maxWidth?: number | string
  tableLayout?: 'auto' | 'fixed'
  rowClassName?: string | ((record: TData, index: number) => string)
  onRowClick?: (record: TData, index: number) => void
  renderExpandedRow?: (record: TData, index: number) => React.ReactNode
  getCanExpand?: (record: TData) => boolean
  expandedRowKeys?: DataTableKey[]
  onExpandedRowChange?: (expandedRowKeys: DataTableKey[]) => void
  className?: string
}

const normalizeKey = (key: DataTableKey) => String(key)

const toCssSize = (value: number | string | undefined) => (typeof value === 'number' ? `${value}px` : value)

const contentContainmentClassName = 'min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere]'

function getColumnMeta<TData>(cell: Cell<TData, unknown>): DataTableColumnMeta | undefined {
  return cell.column.columnDef.meta as DataTableColumnMeta | undefined
}

function getHeaderMeta<TData>(columnDef: ColumnDef<TData, unknown>): DataTableColumnMeta | undefined {
  return columnDef.meta as DataTableColumnMeta | undefined
}

function getAlignClass(align?: DataTableColumnMeta['align']) {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return undefined
}

function getColumnStyle(meta?: DataTableColumnMeta): React.CSSProperties | undefined {
  if (!meta?.width && !meta?.maxWidth) {
    return undefined
  }

  return {
    width: toCssSize(meta.width),
    maxWidth: toCssSize(meta.maxWidth)
  }
}

function DataTable<TData>({
  data,
  columns,
  rowKey,
  selection,
  headerLeft,
  headerRight,
  emptyText = 'No results.',
  maxHeight,
  maxWidth,
  tableLayout = 'auto',
  rowClassName,
  onRowClick,
  renderExpandedRow,
  getCanExpand,
  expandedRowKeys = [],
  onExpandedRowChange,
  className
}: DataTableProps<TData>) {
  const getRecordKey = React.useCallback(
    (record: TData): DataTableKey => {
      if (typeof rowKey === 'function') {
        return rowKey(record)
      }
      return record[rowKey] as DataTableKey
    },
    [rowKey]
  )

  const rowById = React.useMemo(() => {
    const map = new Map<string, { key: DataTableKey; record: TData }>()
    data.forEach((record) => {
      const key = getRecordKey(record)
      map.set(normalizeKey(key), { key, record })
    })
    return map
  }, [data, getRecordKey])

  const selectedRowIds = React.useMemo<RowSelectionState>(() => {
    if (!selection) {
      return {}
    }

    return selection.selectedRowKeys.reduce<RowSelectionState>((acc, key) => {
      acc[normalizeKey(key)] = true
      return acc
    }, {})
  }, [selection])

  const emitSelectionChange = React.useCallback(
    (nextSelection: RowSelectionState) => {
      if (!selection) {
        return
      }

      const selected = Object.keys(nextSelection)
        .filter((id) => nextSelection[id])
        .map((id) => rowById.get(id))
        .filter((entry): entry is { key: DataTableKey; record: TData } => Boolean(entry))

      selection.onChange(
        selected.map((entry) => entry.key),
        selected.map((entry) => entry.record)
      )
    },
    [rowById, selection]
  )

  const handleRowSelectionChange = React.useCallback(
    (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === 'function' ? updater(selectedRowIds) : updater
      emitSelectionChange(next)
    },
    [emitSelectionChange, selectedRowIds]
  )

  const selectionColumn = React.useMemo<ColumnDef<TData> | null>(() => {
    if (!selection) {
      return null
    }

    const width = selection.columnWidth ?? 44

    if (selection.type === 'single') {
      return {
        id: '__selection',
        size: typeof width === 'number' ? width : undefined,
        header: '',
        cell: ({ row }) => {
          const checkboxProps = selection.getCheckboxProps?.(row.original)
          return (
            <div className="flex items-center justify-center">
              <RadioGroupItem
                value={row.id}
                disabled={!row.getCanSelect() || checkboxProps?.disabled}
                aria-label={checkboxProps?.ariaLabel ?? 'Select row'}
                size="sm"
              />
            </div>
          )
        },
        enableSorting: false,
        enableHiding: false,
        meta: { width, maxWidth: width, align: 'center' } satisfies DataTableColumnMeta
      }
    }

    return {
      id: '__selection',
      size: typeof width === 'number' ? width : undefined,
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            size="sm"
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
            onCheckedChange={(checked) => table.toggleAllRowsSelected(Boolean(checked))}
            aria-label="Select all rows"
          />
        </div>
      ),
      cell: ({ row }) => {
        const checkboxProps = selection.getCheckboxProps?.(row.original)
        return (
          <div className="flex items-center justify-center">
            <Checkbox
              size="sm"
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect() || checkboxProps?.disabled}
              onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
              aria-label={checkboxProps?.ariaLabel ?? 'Select row'}
            />
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
      meta: { width, maxWidth: width, align: 'center' } satisfies DataTableColumnMeta
    }
  }, [selection])

  const expandedRowIdSet = React.useMemo(
    () => new Set(expandedRowKeys.map((key) => normalizeKey(key))),
    [expandedRowKeys]
  )

  const toggleExpandedRow = React.useCallback(
    (record: TData) => {
      if (!onExpandedRowChange) {
        return
      }

      const key = getRecordKey(record)
      const id = normalizeKey(key)
      const next = new Set(expandedRowIdSet)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      const orderedKeys = data.map((item) => getRecordKey(item)).filter((itemKey) => next.has(normalizeKey(itemKey)))

      onExpandedRowChange(orderedKeys)
    },
    [data, expandedRowIdSet, getRecordKey, onExpandedRowChange]
  )

  const expandColumn = React.useMemo<ColumnDef<TData> | null>(() => {
    if (!renderExpandedRow) {
      return null
    }

    return {
      id: '__expand',
      size: 36,
      header: '',
      cell: ({ row }) => {
        const canExpand = getCanExpand ? getCanExpand(row.original) : true
        const isExpanded = expandedRowIdSet.has(row.id)

        if (!canExpand) {
          return null
        }

        return (
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation()
              toggleExpandedRow(row.original)
            }}>
            <ChevronRight className={cn('size-4 transition-transform', isExpanded && 'rotate-90')} />
          </button>
        )
      },
      enableSorting: false,
      enableHiding: false,
      meta: { width: 36, maxWidth: 36, align: 'center' } satisfies DataTableColumnMeta
    }
  }, [expandedRowIdSet, getCanExpand, renderExpandedRow, toggleExpandedRow])

  const tableColumns = React.useMemo<ColumnDef<TData>[]>(
    () => [selectionColumn, expandColumn, ...columns].filter((column): column is ColumnDef<TData> => Boolean(column)),
    [columns, expandColumn, selectionColumn]
  )

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId: (record) => normalizeKey(getRecordKey(record)),
    getCoreRowModel: getCoreRowModel(),
    state: {
      rowSelection: selectedRowIds
    },
    enableRowSelection: (row) => !selection?.getCheckboxProps?.(row.original)?.disabled,
    enableMultiRowSelection: selection?.type === 'multiple',
    onRowSelectionChange: handleRowSelectionChange
  })

  const visibleColumnCount = table.getVisibleFlatColumns().length
  const hasToolbar = Boolean(headerLeft || headerRight)
  const tableElement = (
    <div className={cn('w-full max-w-full overflow-hidden rounded-md border border-border bg-background', className)}>
      <div
        style={{ maxHeight: toCssSize(maxHeight) }}
        className={cn('w-full max-w-full overflow-x-auto', maxHeight && 'overflow-y-auto')}>
        <Table className="max-w-full" style={{ tableLayout }}>
          <TableHeader className="sticky top-0 z-1 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = getHeaderMeta(header.column.columnDef)

                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(contentContainmentClassName, getAlignClass(meta?.align), meta?.headerClassName)}
                      style={getColumnStyle(meta)}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, index) => {
                const key = getRecordKey(row.original)
                const isExpanded = expandedRowIdSet.has(normalizeKey(key))
                const customRowClassName =
                  typeof rowClassName === 'function' ? rowClassName(row.original, index) : rowClassName

                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      className={cn(onRowClick && 'cursor-pointer', customRowClassName)}
                      onClick={() => onRowClick?.(row.original, index)}>
                      {row.getVisibleCells().map((cell) => {
                        const meta = getColumnMeta(cell)

                        return (
                          <TableCell
                            key={cell.id}
                            className={cn(contentContainmentClassName, getAlignClass(meta?.align), meta?.className)}
                            style={getColumnStyle(meta)}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                    {renderExpandedRow && isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={visibleColumnCount}
                          className={cn('bg-muted/20 px-4 py-3', contentContainmentClassName)}>
                          <div
                            className={cn(
                              'w-full overflow-hidden',
                              contentContainmentClassName,
                              '[&_table]:w-full [&_table]:table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal'
                            )}>
                            {renderExpandedRow(row.original, index)}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount || 1} className="h-24 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )

  return (
    <div
      data-slot="data-table"
      className="flex w-full max-w-full flex-col gap-2"
      style={{ maxWidth: toCssSize(maxWidth) }}>
      {hasToolbar && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">{headerLeft}</div>
          <div className="flex min-w-0 items-center justify-end gap-2">{headerRight}</div>
        </div>
      )}
      {selection?.type === 'single' ? (
        <RadioGroup
          value={selection.selectedRowKeys[0] === undefined ? '' : normalizeKey(selection.selectedRowKeys[0])}
          onValueChange={(value) => {
            const selected = rowById.get(value)
            selection.onChange(selected ? [selected.key] : [], selected ? [selected.record] : [])
          }}
          className="block">
          {tableElement}
        </RadioGroup>
      ) : (
        tableElement
      )}
    </div>
  )
}

export { DataTable }
export type { ColumnDef }

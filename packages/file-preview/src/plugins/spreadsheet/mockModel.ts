import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX } from './gridLayout'
import type { WorkbookRenderModel } from './renderModel'

/**
 * Handwritten sample model for development and tests.
 * Covers multiple sheets (including hidden), styles, merged ranges, hidden rows/columns, non-default sizes,
 * the three formula states, hyperlinks, floating images, bar charts, and unsupported chart placeholders.
 * Tests may shallow-copy and adjust this model, but should not mutate this file directly.
 */
export const createMockWorkbookModel = (): WorkbookRenderModel => ({
  fileName: 'mock-sales.xlsx',
  styles: [
    // 0: title (merged-range master)
    {
      bold: true,
      fontSizePx: 21,
      color: '#ffffff',
      bg: '#4472c4',
      hAlign: 'center',
      vAlign: 'middle'
    },
    // 1: header
    {
      bold: true,
      bg: '#d9e1f2',
      hAlign: 'center',
      borderBottom: { style: 'thin', color: '#8ea9db' }
    },
    // 2: numeric column (right aligned + currency format)
    { hAlign: 'right', numFmt: '#,##0.00' },
    // 3: wrapped long text
    { wrap: true, vAlign: 'top' },
    // 4: date
    { hAlign: 'center', numFmt: 'yyyy-mm-dd' }
  ],
  images: {
    1: { mime: 'image/png', data: new ArrayBuffer(8) }
  },
  warnings: [],
  sheets: [
    {
      name: 'Sales',
      hidden: false,
      rowCount: 60,
      colCount: 10,
      defaultRowHeightPx: DEFAULT_ROW_HEIGHT_PX,
      defaultColWidthPx: DEFAULT_COL_WIDTH_PX,
      rowHeightsPx: { 1: 36, 7: 0 }, // row 7 hidden
      colWidthsPx: { 1: 110, 5: 0 }, // column E hidden
      merges: [{ top: 1, left: 1, bottom: 1, right: 4 }],
      cells: {
        '1:1': { text: '2026 Sales Summary', raw: '2026 Sales Summary', styleId: 0 },
        '2:1': { text: 'Quarter', raw: 'Quarter', styleId: 1 },
        '2:2': { text: 'Sales', raw: 'Sales', styleId: 1 },
        '2:3': { text: 'Date', raw: 'Date', styleId: 1 },
        '2:4': { text: 'Notes', raw: 'Notes', styleId: 1 },
        '3:1': { text: 'Q1', raw: 'Q1' },
        '3:2': { text: '1,250.00', raw: 1250, styleId: 2 },
        '3:3': { text: '2026-01-15', raw: 45672, styleId: 4 },
        '3:4': {
          text: 'Holiday campaign boosted demand, with channel restocking concentrated in late January.',
          raw: 'Holiday campaign boosted demand, with channel restocking concentrated in late January.',
          styleId: 3
        },
        '4:1': { text: 'Q2', raw: 'Q2' },
        '4:2': { text: '980.50', raw: 980.5, styleId: 2 },
        '5:1': { text: 'Q3', raw: 'Q3' },
        '5:2': { text: '1,530.25', raw: 1530.25, styleId: 2 },
        '6:1': { text: 'Total', raw: 'Total', styleId: 1 },
        // Three formula states.
        '6:2': { text: '3,760.75', raw: 3760.75, formula: 'SUM(B3:B5)', formulaState: 'cached', styleId: 2 },
        '8:1': { text: 'Average', raw: 'Average' },
        '8:2': { text: '1,253.58', raw: 1253.583, formula: 'AVERAGE(B3:B5)', formulaState: 'evaluated', styleId: 2 },
        '9:1': { text: 'Forecast', raw: 'Forecast' },
        '9:2': { text: '=FOOBAR(B3:B5)', formula: 'FOOBAR(B3:B5)', formulaState: 'unevaluated' },
        '10:1': {
          text: 'Cherry Studio',
          raw: 'Cherry Studio',
          hyperlink: 'https://github.com/CherryHQ/cherry-studio'
        },
        // Far cell used to verify virtual scrolling.
        '60:10': { text: 'Scroll to me', raw: 'Scroll to me' }
      },
      floatingImages: [{ rect: { x: 340, y: 44, width: 160, height: 90 }, imageId: 1 }],
      charts: [
        {
          rect: { x: 24, y: 240, width: 360, height: 220 },
          type: 'bar',
          title: 'Quarterly Sales',
          barDirection: 'col',
          series: [{ name: 'Sales', categories: ['Q1', 'Q2', 'Q3'], values: [1250, 980.5, 1530.25] }]
        },
        {
          rect: { x: 420, y: 240, width: 300, height: 220 },
          type: 'unsupported',
          rawTypeName: 'scatterChart',
          series: []
        }
      ]
    },
    {
      name: 'Notes',
      hidden: false,
      rowCount: 3,
      colCount: 2,
      defaultRowHeightPx: DEFAULT_ROW_HEIGHT_PX,
      defaultColWidthPx: DEFAULT_COL_WIDTH_PX,
      rowHeightsPx: {},
      colWidthsPx: {},
      merges: [],
      cells: {
        '1:1': { text: 'Plain sheet', raw: 'Plain sheet' },
        '3:2': { text: 'TRUE', raw: true }
      },
      floatingImages: [],
      charts: []
    },
    {
      name: 'HiddenSheet',
      hidden: true,
      rowCount: 1,
      colCount: 1,
      defaultRowHeightPx: DEFAULT_ROW_HEIGHT_PX,
      defaultColWidthPx: DEFAULT_COL_WIDTH_PX,
      rowHeightsPx: {},
      colWidthsPx: {},
      merges: [],
      cells: { '1:1': { text: 'Should not display', raw: 'Should not display' } },
      floatingImages: [],
      charts: []
    }
  ]
})

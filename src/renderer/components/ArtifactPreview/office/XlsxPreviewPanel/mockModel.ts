import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX } from './gridLayout'
import type { WorkbookRenderModel } from './renderModel'

/**
 * 供 WP-D 开发/测试用的手写样例模型(冻结)。
 * 覆盖:多 sheet(含 hidden)、样式、合并区、隐藏行列、非默认尺寸、
 * 三种公式态、超链接、浮动图片、bar 图表、unsupported 图表占位。
 * 测试可在此基础上浅拷贝改造,不要直接改本文件。
 */
export const createMockWorkbookModel = (): WorkbookRenderModel => ({
  fileName: 'mock-sales.xlsx',
  styles: [
    // 0: 标题(合并区 master)
    {
      bold: true,
      fontSizePx: 21,
      color: '#ffffff',
      bg: '#4472c4',
      hAlign: 'center',
      vAlign: 'middle'
    },
    // 1: 表头
    {
      bold: true,
      bg: '#d9e1f2',
      hAlign: 'center',
      borderBottom: { style: 'thin', color: '#8ea9db' }
    },
    // 2: 数字列(右对齐 + 货币格式)
    { hAlign: 'right', numFmt: '#,##0.00' },
    // 3: 换行长文本
    { wrap: true, vAlign: 'top' },
    // 4: 日期
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
      rowHeightsPx: { 1: 36, 7: 0 }, // 行 7 隐藏
      colWidthsPx: { 1: 110, 5: 0 }, // 列 E 隐藏
      merges: [{ top: 1, left: 1, bottom: 1, right: 4 }],
      cells: {
        '1:1': { text: '2026 年度销售汇总', raw: '2026 年度销售汇总', styleId: 0 },
        '2:1': { text: '季度', raw: '季度', styleId: 1 },
        '2:2': { text: '销量', raw: '销量', styleId: 1 },
        '2:3': { text: '日期', raw: '日期', styleId: 1 },
        '2:4': { text: '备注', raw: '备注', styleId: 1 },
        '3:1': { text: 'Q1', raw: 'Q1' },
        '3:2': { text: '1,250.00', raw: 1250, styleId: 2 },
        '3:3': { text: '2026-01-15', raw: 45672, styleId: 4 },
        '3:4': {
          text: '春节档期拉动,环比增长明显,渠道补货集中在一月下旬。',
          raw: '春节档期拉动,环比增长明显,渠道补货集中在一月下旬。',
          styleId: 3
        },
        '4:1': { text: 'Q2', raw: 'Q2' },
        '4:2': { text: '980.50', raw: 980.5, styleId: 2 },
        '5:1': { text: 'Q3', raw: 'Q3' },
        '5:2': { text: '1,530.25', raw: 1530.25, styleId: 2 },
        '6:1': { text: '合计', raw: '合计', styleId: 1 },
        // 三种公式态
        '6:2': { text: '3,760.75', raw: 3760.75, formula: 'SUM(B3:B5)', formulaState: 'cached', styleId: 2 },
        '8:1': { text: '均值', raw: '均值' },
        '8:2': { text: '1,253.58', raw: 1253.583, formula: 'AVERAGE(B3:B5)', formulaState: 'evaluated', styleId: 2 },
        '9:1': { text: '预测', raw: '预测' },
        '9:2': { text: '=FOOBAR(B3:B5)', formula: 'FOOBAR(B3:B5)', formulaState: 'unevaluated' },
        '10:1': {
          text: 'Cherry Studio',
          raw: 'Cherry Studio',
          hyperlink: 'https://github.com/CherryHQ/cherry-studio'
        },
        // 远端单元格:验证虚拟滚动
        '60:10': { text: '滚动到我', raw: '滚动到我' }
      },
      floatingImages: [{ rect: { x: 340, y: 44, width: 160, height: 90 }, imageId: 1 }],
      charts: [
        {
          rect: { x: 24, y: 240, width: 360, height: 220 },
          type: 'bar',
          title: '季度销量',
          barDirection: 'col',
          series: [{ name: '销量', categories: ['Q1', 'Q2', 'Q3'], values: [1250, 980.5, 1530.25] }]
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
        '1:1': { text: '普通表', raw: '普通表' },
        '3:2': { text: 'TRUE', raw: true }
      },
      floatingImages: [],
      charts: [],
      frozen: { xSplit: 0, ySplit: 1 }
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
      cells: { '1:1': { text: '不应显示', raw: '不应显示' } },
      floatingImages: [],
      charts: []
    }
  ]
})

import { sortedObjectByKeys } from '../sort'

describe('sortedObjectByKeys', () => {
  test('should sort keys of a flat object alphabetically', () => {
    const obj = { b: 2, a: 1, c: 3 }
    const sortedObj = { a: 1, b: 2, c: 3 }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should sort keys of nested objects alphabetically', () => {
    const obj = {
      c: { z: 3, y: 2, x: 1 },
      a: 1,
      b: { f: 6, d: 4, e: 5 }
    }
    const sortedObj = {
      a: 1,
      b: { d: 4, e: 5, f: 6 },
      c: { x: 1, y: 2, z: 3 }
    }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should handle empty objects', () => {
    const obj = {}
    expect(sortedObjectByKeys(obj)).toEqual({})
  })

  test('should handle objects with non-object values', () => {
    const obj = { b: 'hello', a: 123, c: true }
    const sortedObj = { a: 123, b: 'hello', c: true }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should handle objects with array values', () => {
    const obj = { b: [2, 1], a: [1, 2] }
    const sortedObj = { a: [1, 2], b: [2, 1] }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should handle objects with null values', () => {
    const obj = { b: null, a: 1 }
    const sortedObj = { a: 1, b: null }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should handle objects with undefined values', () => {
    const obj = { b: undefined, a: 1 }
    const sortedObj = { a: 1, b: undefined }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })

  test('should not modify the original object', () => {
    const obj = { b: 2, a: 1 }
    sortedObjectByKeys(obj)
    expect(obj).toEqual({ b: 2, a: 1 })
  })

  test('should handle objects read from i18n JSON files', () => {
    const obj = {
      translation: {
        backup: {
          progress: {
            writing_data: '写入数据...',
            preparing: '准备备份...',
            completed: '备份完成'
          }
        },
        agents: {
          'delete.popup.content': '确定要删除此智能体吗？',
          'edit.model.select.title': '选择模型'
        }
      }
    }
    const sortedObj = {
      translation: {
        agents: {
          'delete.popup.content': '确定要删除此智能体吗？',
          'edit.model.select.title': '选择模型'
        },
        backup: {
          progress: {
            completed: '备份完成',
            preparing: '准备备份...',
            writing_data: '写入数据...'
          }
        }
      }
    }
    expect(sortedObjectByKeys(obj)).toEqual(sortedObj)
  })
})

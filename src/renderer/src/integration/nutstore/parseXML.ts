import { XMLParser } from 'fast-xml-parser'

export function parseXml<T>(xml: string) {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    removeNSPrefix: true
  })
  return parser.parse(xml) as T
}

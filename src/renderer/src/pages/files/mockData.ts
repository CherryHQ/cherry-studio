export interface FileItem {
  id: string
  name: string
  type: 'image' | 'video' | 'audio' | 'text' | 'document' | 'other'
  format: string
  size: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
  folder?: string
  trashed: boolean
}

export const MOCK_FILES: FileItem[] = [
  {
    id: 'file1',
    name: '赛博朋克城市.png',
    type: 'image',
    format: 'png',
    size: '4.2 MB',
    sizeBytes: 4404019,
    createdAt: '2026-02-25 14:30',
    updatedAt: '2026-02-25 14:30',
    folder: '~/Pictures/AI',
    trashed: false
  },
  {
    id: 'file2',
    name: '水墨山水画.jpg',
    type: 'image',
    format: 'jpg',
    size: '3.1 MB',
    sizeBytes: 3250585,
    createdAt: '2026-02-24 09:15',
    updatedAt: '2026-02-24 09:15',
    folder: '~/Pictures/AI',
    trashed: false
  },
  {
    id: 'file3',
    name: '产品 Logo 设计方案.png',
    type: 'image',
    format: 'png',
    size: '1.8 MB',
    sizeBytes: 1887436,
    createdAt: '2026-02-23 16:45',
    updatedAt: '2026-02-24 10:20',
    folder: '~/Documents/Cherry Studio',
    trashed: false
  },
  {
    id: 'file4',
    name: '日落海滩.jpg',
    type: 'image',
    format: 'jpg',
    size: '5.6 MB',
    sizeBytes: 5872025,
    createdAt: '2026-02-22 18:00',
    updatedAt: '2026-02-22 18:00',
    folder: '~/Pictures/AI',
    trashed: false
  },
  {
    id: 'file5',
    name: '界面截图 v2.png',
    type: 'image',
    format: 'png',
    size: '892 KB',
    sizeBytes: 913408,
    createdAt: '2026-02-21 11:30',
    updatedAt: '2026-02-21 11:30',
    folder: '~/Documents/Cherry Studio',
    trashed: false
  },
  {
    id: 'file6',
    name: 'RAG 技术白皮书.pdf',
    type: 'document',
    format: 'pdf',
    size: '8.4 MB',
    sizeBytes: 8808038,
    createdAt: '2026-02-25 10:00',
    updatedAt: '2026-02-25 10:00',
    folder: '~/Documents/学习资料',
    trashed: false
  },
  {
    id: 'file7',
    name: '产品需求文档 v3.docx',
    type: 'document',
    format: 'docx',
    size: '2.1 MB',
    sizeBytes: 2201927,
    createdAt: '2026-02-24 15:30',
    updatedAt: '2026-02-25 09:00',
    folder: '~/Documents/Cherry Studio',
    trashed: false
  },
  {
    id: 'file8',
    name: '竞品分析报告.pdf',
    type: 'document',
    format: 'pdf',
    size: '5.3 MB',
    sizeBytes: 5557453,
    createdAt: '2026-02-23 14:00',
    updatedAt: '2026-02-23 14:00',
    folder: '~/Documents',
    trashed: false
  },
  {
    id: 'file9',
    name: 'LLM 评测结果.pdf',
    type: 'document',
    format: 'pdf',
    size: '3.7 MB',
    sizeBytes: 3879731,
    createdAt: '2026-02-22 16:20',
    updatedAt: '2026-02-22 16:20',
    folder: '~/Documents/学习资料',
    trashed: false
  },
  {
    id: 'file10',
    name: '用户调研摘要.docx',
    type: 'document',
    format: 'docx',
    size: '780 KB',
    sizeBytes: 798720,
    createdAt: '2026-02-20 13:00',
    updatedAt: '2026-02-21 08:30',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file11',
    name: '2026 Q1 计划.pdf',
    type: 'document',
    format: 'pdf',
    size: '1.2 MB',
    sizeBytes: 1258291,
    createdAt: '2026-02-18 09:00',
    updatedAt: '2026-02-19 14:00',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file12',
    name: 'data-pipeline.py',
    type: 'text',
    format: 'py',
    size: '12 KB',
    sizeBytes: 12288,
    createdAt: '2026-02-25 11:45',
    updatedAt: '2026-02-25 16:00',
    folder: '~/Code/scripts',
    trashed: false
  },
  {
    id: 'file13',
    name: 'FileManager.tsx',
    type: 'text',
    format: 'tsx',
    size: '8.5 KB',
    sizeBytes: 8704,
    createdAt: '2026-02-24 20:00',
    updatedAt: '2026-02-25 11:30',
    folder: '~/Code/cherry-studio',
    trashed: false
  },
  {
    id: 'file14',
    name: 'api-schema.json',
    type: 'text',
    format: 'json',
    size: '4.2 KB',
    sizeBytes: 4300,
    createdAt: '2026-02-23 10:30',
    updatedAt: '2026-02-23 10:30',
    folder: '~/Code/cherry-studio',
    trashed: false
  },
  {
    id: 'file15',
    name: 'embedding-utils.py',
    type: 'text',
    format: 'py',
    size: '6.8 KB',
    sizeBytes: 6963,
    createdAt: '2026-02-22 14:15',
    updatedAt: '2026-02-22 14:15',
    folder: '~/Code/scripts',
    trashed: false
  },
  {
    id: 'file16',
    name: 'config.yaml',
    type: 'text',
    format: 'yaml',
    size: '2.1 KB',
    sizeBytes: 2150,
    createdAt: '2026-02-21 09:00',
    updatedAt: '2026-02-21 09:00',
    folder: '~/Code/cherry-studio',
    trashed: false
  },
  {
    id: 'file17',
    name: '会议录音-0225.mp3',
    type: 'audio',
    format: 'mp3',
    size: '24 MB',
    sizeBytes: 25165824,
    createdAt: '2026-02-25 15:00',
    updatedAt: '2026-02-25 15:00',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file18',
    name: 'demo-video.mp4',
    type: 'video',
    format: 'mp4',
    size: '48 MB',
    sizeBytes: 50331648,
    createdAt: '2026-02-24 12:00',
    updatedAt: '2026-02-24 12:00',
    folder: '~/Documents/Cherry Studio',
    trashed: false
  },
  {
    id: 'file19',
    name: '旧版设计稿.png',
    type: 'image',
    format: 'png',
    size: '2.5 MB',
    sizeBytes: 2621440,
    createdAt: '2026-02-15 10:00',
    updatedAt: '2026-02-20 09:00',
    trashed: true
  },
  {
    id: 'file20',
    name: '废弃的脚本.py',
    type: 'text',
    format: 'py',
    size: '3.4 KB',
    sizeBytes: 3481,
    createdAt: '2026-02-10 14:00',
    updatedAt: '2026-02-18 16:00',
    trashed: true
  },
  {
    id: 'file21',
    name: '未来太空站.png',
    type: 'image',
    format: 'png',
    size: '6.1 MB',
    sizeBytes: 6396313,
    createdAt: '2026-02-20 17:00',
    updatedAt: '2026-02-20 17:00',
    folder: '~/Pictures/AI',
    trashed: false
  },
  {
    id: 'file22',
    name: '极简建筑.jpg',
    type: 'image',
    format: 'jpg',
    size: '2.9 MB',
    sizeBytes: 3040870,
    createdAt: '2026-02-19 13:30',
    updatedAt: '2026-02-19 13:30',
    folder: '~/Pictures/AI',
    trashed: false
  },
  {
    id: 'file23',
    name: '会议纪要.md',
    type: 'text',
    format: 'md',
    size: '5.4 KB',
    sizeBytes: 5530,
    createdAt: '2026-02-24 19:00',
    updatedAt: '2026-02-24 19:00',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file24',
    name: 'TODO.txt',
    type: 'text',
    format: 'txt',
    size: '420 B',
    sizeBytes: 420,
    createdAt: '2026-02-22 08:30',
    updatedAt: '2026-02-25 17:00',
    trashed: false
  },
  {
    id: 'file25',
    name: '年度预算.xlsx',
    type: 'document',
    format: 'xlsx',
    size: '1.8 MB',
    sizeBytes: 1887436,
    createdAt: '2026-02-18 11:00',
    updatedAt: '2026-02-23 09:15',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file26',
    name: 'Q1 路演 PPT.pptx',
    type: 'document',
    format: 'pptx',
    size: '12 MB',
    sizeBytes: 12582912,
    createdAt: '2026-02-17 14:00',
    updatedAt: '2026-02-19 10:00',
    folder: '~/Documents/会议',
    trashed: false
  },
  {
    id: 'file27',
    name: 'model-weights.bin',
    type: 'other',
    format: 'bin',
    size: '210 MB',
    sizeBytes: 220200960,
    createdAt: '2026-02-16 22:00',
    updatedAt: '2026-02-16 22:00',
    folder: '~/Code/scripts',
    trashed: false
  },
  {
    id: 'file28',
    name: 'license-key',
    type: 'other',
    format: '',
    size: '128 B',
    sizeBytes: 128,
    createdAt: '2026-02-14 09:00',
    updatedAt: '2026-02-14 09:00',
    trashed: false
  }
]

export function getFormatLabel(format: string): string {
  const map: Record<string, string> = {
    png: 'PNG',
    jpg: 'JPG',
    pdf: 'PDF',
    docx: 'DOCX',
    py: 'Python',
    tsx: 'TSX',
    json: 'JSON',
    yaml: 'YAML',
    mp3: 'MP3',
    mp4: 'MP4',
    md: 'Markdown',
    txt: 'Text',
    xlsx: 'Excel',
    pptx: 'PPT',
    bin: 'Binary'
  }
  return map[format] || format.toUpperCase()
}

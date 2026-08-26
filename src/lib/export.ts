import type { Word } from '@/types/domain'

export type ExportFormat = 'txt' | 'csv' | 'json'

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function serialise(words: Word[], format: ExportFormat): { content: string; mime: string } {
  switch (format) {
    case 'txt':
      return {
        content: words
          .map((w) =>
            [w.word, w.definition, `Part of speech: ${w.partOfSpeech}`, w.example ?? '']
              .filter(Boolean)
              .join('\n'),
          )
          .join('\n---\n'),
        mime: 'text/plain;charset=utf-8',
      }

    case 'csv':
      return {
        content: [
          'Word,Definition,Part of Speech,Example,Folder',
          ...words.map((w) =>
            [w.word, w.definition, w.partOfSpeech, w.example ?? '', w.folder]
              .map(csvCell)
              .join(','),
          ),
        ].join('\n'),
        mime: 'text/csv;charset=utf-8',
      }

    case 'json':
    default:
      return { content: JSON.stringify(words, null, 2), mime: 'application/json;charset=utf-8' }
  }
}

export function exportFileName(format: ExportFormat): string {
  return `dictionary_${new Date().toISOString().split('T')[0]}.${format}`
}

export function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function exportWords(words: Word[], format: ExportFormat): void {
  const { content, mime } = serialise(words, format)
  download(content, exportFileName(format), mime)
}

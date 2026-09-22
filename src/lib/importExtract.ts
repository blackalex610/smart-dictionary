/**
 * Turns an uploaded file into the plain text the `structure-words` AI endpoint
 * expects. The paper specifies .TXT, .RTF, .DOCX, .DOC, .MD, .HTML and .XML, so
 * each of those gets its own extraction path; everything else is read verbatim.
 */

export const IMPORT_ACCEPT =
  '.txt,.md,.csv,.json,.rtf,.doc,.docx,.htm,.html,.xml,' +
  'text/plain,text/markdown,text/csv,application/json,application/rtf,text/rtf,' +
  'application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'text/html,application/xml,text/xml'

export class UnreadableFileError extends Error {
  constructor(public readonly reason: 'empty' | 'unsupported' | 'corrupt') {
    super(`UNREADABLE_FILE_${reason.toUpperCase()}`)
    this.name = 'UnreadableFileError'
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/** Normalises line endings, collapses inline whitespace and blank-line runs. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Strips HTML/XML down to its text. Block-level tags become blank lines so the
 * paragraph splitting in `importOptions` still has something to work with.
 */
export function stripMarkup(markup: string): string {
  const withoutNoise = markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)\s*>/gi, '\n\n')
    .replace(/<\/(td|th)\s*>/gi, '\t')

  return tidy(decodeEntities(withBreaks.replace(/<[^>]*>/g, '')))
}

const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008d' + 'Ž\u008f\u0090‘’“”•–—˜™š›' + 'œ\u009džŸ'

function cp1252Char(code: number): string {
  if (code >= 0x80 && code <= 0x9f) return CP1252_HIGH[code - 0x80] ?? ''
  return String.fromCharCode(code)
}

/**
 * Strips RTF control words, groups and escapes. Destination groups that carry
 * no document text (fonts, colours, stylesheets, ...) are dropped whole.
 */
export function stripRtf(rtf: string): string {
  const SKIP_DESTINATIONS =
    /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|filetbl|mmathPr)\b/

  let out = ''
  let depth = 0
  const skipFrom: number[] = []
  let index = 0

  const skipping = () => skipFrom.length > 0

  while (index < rtf.length) {
    const char = rtf[index]

    if (char === '\\') {
      const escaped = rtf[index + 1]

      if (escaped === '\\' || escaped === '{' || escaped === '}') {
        if (!skipping()) out += escaped
        index += 2
        continue
      }
      if (escaped === "'") {
        // RTF hex escapes are code-page bytes; CP-1252 is the overwhelming default.
        const code = Number.parseInt(rtf.slice(index + 2, index + 4), 16)
        if (!skipping() && Number.isFinite(code)) out += cp1252Char(code)
        index += 4
        continue
      }
      if (escaped === '*') {
        index += 2
        continue
      }
      if (escaped === '\n' || escaped === '\r') {
        if (!skipping()) out += '\n'
        index += 2
        continue
      }

      const control = /^\\([a-z]+)(-?\d+)?[ ]?/i.exec(rtf.slice(index))
      if (!control) {
        index += 1
        continue
      }
      const [matched, word, param] = control

      if (!skipping()) {
        if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += '\n'
        else if (word === 'tab') out += '\t'
        else if (word === 'u' && param) {
          const code = Number.parseInt(param, 10)
          out += String.fromCodePoint(code < 0 ? code + 0x10000 : code)
        }
      }
      if (SKIP_DESTINATIONS.test(rtf.slice(index + 1))) skipFrom.push(depth)

      index += matched.length
      continue
    }

    if (char === '{') {
      depth += 1
      index += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (skipFrom.length > 0 && depth < skipFrom[skipFrom.length - 1]) skipFrom.pop()
      index += 1
      continue
    }

    if (!skipping() && char !== '\n' && char !== '\r') out += char
    index += 1
  }

  return tidy(out)
}

/* ------------------------------------------------------------------ ZIP ---- */

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new UnreadableFileError('unsupported')

  // Fed from a ReadableStream rather than a Blob: `Blob.stream` is missing in
  // some environments, and the copy is needed anyway because `data` is a view
  // into the archive's buffer.
  // Typed as BufferSource to line up with DecompressionStream's writable side.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(data))
      controller.close()
    },
  })

  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Reads one named entry out of a ZIP archive. Returns null when it is absent. */
async function readZipEntry(buffer: ArrayBuffer, name: string): Promise<Uint8Array | null> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // End of central directory: scan back over the (max 64 KiB) trailing comment.
  let eocd = -1
  const earliest = Math.max(0, bytes.length - 0x10000 - 22)
  for (let i = bytes.length - 22; i >= earliest; i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new UnreadableFileError('corrupt')

  const entries = u16(view, eocd + 10)
  let cursor = u32(view, eocd + 16)

  for (let i = 0; i < entries && cursor + 46 <= bytes.length; i++) {
    if (u32(view, cursor) !== 0x02014b50) break

    const method = u16(view, cursor + 10)
    const compressedSize = u32(view, cursor + 20)
    const nameLength = u16(view, cursor + 28)
    const extraLength = u16(view, cursor + 30)
    const commentLength = u16(view, cursor + 32)
    const localOffset = u32(view, cursor + 42)
    const entryName = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    )

    if (entryName === name) {
      if (u32(view, localOffset) !== 0x04034b50) throw new UnreadableFileError('corrupt')
      const start = localOffset + 30 + u16(view, localOffset + 26) + u16(view, localOffset + 28)
      const data = bytes.subarray(start, start + compressedSize)
      if (method === 0) return data
      if (method === 8) return inflateRaw(data)
      throw new UnreadableFileError('unsupported')
    }

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return null
}

/** WordprocessingML to text: paragraphs become lines, tabs and breaks survive. */
export function wordXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
  return tidy(decodeEntities(withBreaks.replace(/<[^>]*>/g, '')))
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const entry = await readZipEntry(buffer, 'word/document.xml')
  if (!entry) throw new UnreadableFileError('corrupt')
  return wordXmlToText(new TextDecoder().decode(entry))
}

/* ------------------------------------------------------- legacy binary ---- */

/**
 * Word 97-2003 keeps its text inside an OLE compound file we do not parse.
 * Pulling out the printable runs recovers the word list in practice, which is
 * all the importer needs before handing the text to the AI.
 */
export function extractPrintableRuns(bytes: Uint8Array, minRun = 4): string {
  const collect = (next: (index: number) => number, step: number): string[] => {
    const parts: string[] = []
    let run = ''
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      const code = next(i)
      if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f)) {
        run += step === 1 ? cp1252Char(code) : String.fromCharCode(code)
      } else {
        if (run.trim().length >= minRun) parts.push(run.trim())
        run = ''
      }
    }
    if (run.trim().length >= minRun) parts.push(run.trim())
    return parts
  }

  const eightBit = collect((i) => bytes[i], 1)
  const utf16 = collect((i) => bytes[i] | (bytes[i + 1] << 8), 2)

  const letters = (parts: string[]) => parts.join('').replace(/[^\p{L}]/gu, '').length
  return tidy((letters(utf16) > letters(eightBit) ? utf16 : eightBit).join('\n'))
}

/* ------------------------------------------------------------ dispatch ---- */

type Magic = 'zip' | 'rtf' | 'ole' | 'markup' | null

function sniff(bytes: Uint8Array): Magic {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return 'zip'
    }
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      return 'ole'
    }
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart()
  if (head.startsWith('{\\rtf')) return 'rtf'
  if (/^<(\?xml|!doctype html|html)\b/i.test(head)) return 'markup'
  return null
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/**
 * Reads `file` as text. The real format wins over the extension, so a `.doc`
 * that is really a `.docx` (or an `.xml` that is really RTF) still imports.
 */
export async function extractFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes.length === 0) throw new UnreadableFileError('empty')

  const magic = sniff(bytes)
  const extension = extensionOf(file.name)

  if (magic === 'zip' || (magic === null && extension === 'docx')) return extractDocx(buffer)
  if (magic === 'ole') return extractPrintableRuns(bytes)

  const text = new TextDecoder('utf-8').decode(bytes)

  if (magic === 'rtf' || extension === 'rtf') return stripRtf(text)
  if (magic === 'markup' || extension === 'html' || extension === 'htm' || extension === 'xml') {
    return stripMarkup(text)
  }
  if (extension === 'doc') return extractPrintableRuns(bytes)

  return tidy(text)
}

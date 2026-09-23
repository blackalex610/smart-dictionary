import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { extractFileText } from './importExtract'

/** Builds a one-entry ZIP the way a .docx stores `word/document.xml`. */
function buildZip(name: string, contents: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const nameBytes = encoder.encode(name)
  const raw = encoder.encode(contents)
  const deflated = new Uint8Array(deflateRawSync(raw))

  // CRC-32 is never checked by our reader, so a zero placeholder is fine.
  const local = new Uint8Array(30 + nameBytes.length + deflated.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(8, 8, true) // deflate
  localView.setUint32(18, deflated.length, true)
  localView.setUint32(22, raw.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  local.set(deflated, 30 + nameBytes.length)

  const central = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(10, 8, true)
  centralView.setUint32(20, deflated.length, true)
  centralView.setUint32(24, raw.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralView.setUint32(42, 0, true) // local header offset
  central.set(nameBytes, 46)

  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, 1, true)
  eocdView.setUint16(10, 1, true)
  eocdView.setUint32(12, central.length, true)
  eocdView.setUint32(16, local.length, true)

  const zip = new Uint8Array(local.length + central.length + eocd.length)
  zip.set(local, 0)
  zip.set(central, local.length)
  zip.set(eocd, local.length + central.length)
  return zip
}

const DOCUMENT_XML =
  '<?xml version="1.0"?><w:document><w:body>' +
  '<w:p><w:r><w:t>set off</w:t></w:r><w:r><w:tab/><w:t>to begin a journey</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>brisk</w:t></w:r></w:p>' +
  '</w:body></w:document>'

describe('extractFileText for .docx', () => {
  it('inflates word/document.xml and reads its paragraphs', async () => {
    const zip = buildZip('word/document.xml', DOCUMENT_XML)
    const file = new File([zip], 'words.docx')
    await expect(extractFileText(file)).resolves.toBe('set off to begin a journey\nbrisk')
  })

  it('reads a .doc that is really a .docx, going by the magic bytes', async () => {
    const zip = buildZip('word/document.xml', DOCUMENT_XML)
    const file = new File([zip], 'words.doc')
    await expect(extractFileText(file)).resolves.toContain('brisk')
  })

  it('rejects an archive with no document part', async () => {
    const file = new File([buildZip('other.xml', '<a/>')], 'words.docx')
    await expect(extractFileText(file)).rejects.toThrow('UNREADABLE_FILE_CORRUPT')
  })

  it('rejects an empty file', async () => {
    await expect(extractFileText(new File([], 'empty.txt'))).rejects.toThrow(
      'UNREADABLE_FILE_EMPTY',
    )
  })

  it('reads an .html file as text', async () => {
    const file = new File(['<html><body><p>alpha</p><p>beta</p></body></html>'], 'w.html')
    await expect(extractFileText(file)).resolves.toBe('alpha\n\nbeta')
  })

  it('detects RTF from its signature regardless of the extension', async () => {
    const file = new File(['{\\rtf1\\ansi alpha\\par beta\\par}'], 'w.txt')
    await expect(extractFileText(file)).resolves.toBe('alpha\nbeta')
  })
})

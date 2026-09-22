import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  extensionOf,
  extractPrintableRuns,
  stripMarkup,
  stripRtf,
  tidy,
  wordXmlToText,
} from './importExtract'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('a &amp; b &#65; c &#x42;')).toBe('a & b A c B')
  })

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;')
  })
})

describe('tidy', () => {
  it('normalises line endings and collapses blank-line runs', () => {
    expect(tidy('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb')
  })

  it('collapses inline whitespace including non-breaking spaces', () => {
    expect(tidy('a  \t b')).toBe('a b')
  })
})

describe('stripMarkup', () => {
  it('drops tags and keeps block structure', () => {
    const html = '<html><body><p>alpha</p><p>beta</p></body></html>'
    expect(stripMarkup(html)).toBe('alpha\n\nbeta')
  })

  it('removes script and style content entirely', () => {
    const html = '<p>keep</p><script>var drop = 1</script><style>.drop{}</style>'
    expect(stripMarkup(html)).toBe('keep')
  })

  it('unwraps CDATA and decodes entities in XML', () => {
    const xml = '<?xml version="1.0"?><w><d><![CDATA[a &amp; b]]></d></w>'
    expect(stripMarkup(xml)).toBe('a & b')
  })

  it('turns <br> into a line break', () => {
    expect(stripMarkup('one<br/>two')).toBe('one\ntwo')
  })
})

describe('stripRtf', () => {
  it('reads plain paragraphs', () => {
    const rtf = '{\\rtf1\\ansi alpha\\par beta\\par}'
    expect(stripRtf(rtf)).toBe('alpha\nbeta')
  })

  it('drops the font table destination', () => {
    const rtf = '{\\rtf1{\\fonttbl{\\f0 Times New Roman;}}word, meaning, noun\\par}'
    expect(stripRtf(rtf)).toBe('word, meaning, noun')
  })

  it('decodes hex and unicode escapes', () => {
    expect(stripRtf("{\\rtf1 caf\\'e9\\par}")).toBe('café')
    // The single space after a control word is its delimiter, not content.
    expect(stripRtf('{\\rtf1 \\u1076 x\\par}')).toBe('дx')
  })

  it('keeps escaped braces and backslashes', () => {
    expect(stripRtf('{\\rtf1 a\\{b\\}c\\\\d\\par}')).toBe('a{b}c\\d')
  })
})

describe('wordXmlToText', () => {
  it('turns paragraphs into lines and keeps tabs', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>word</w:t></w:r><w:r><w:tab/><w:t>meaning</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>second</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    expect(wordXmlToText(xml)).toBe('word meaning\nsecond')
  })

  it('decodes entities inside runs', () => {
    expect(wordXmlToText('<w:p><w:t>a &amp; b</w:t></w:p>')).toBe('a & b')
  })
})

describe('extractPrintableRuns', () => {
  it('keeps runs at or above the minimum length', () => {
    const bytes = new Uint8Array([
      0x00,
      0x01,
      ...new TextEncoder().encode('alpha'),
      0x00,
      0x02,
      ...new TextEncoder().encode('b'),
      0x00,
    ])
    expect(extractPrintableRuns(bytes)).toBe('alpha')
  })

  it('prefers the UTF-16 reading when it carries more letters', () => {
    const utf16 = new Uint8Array([...'hello world'].flatMap((char) => [char.charCodeAt(0), 0x00]))
    expect(extractPrintableRuns(utf16)).toBe('hello world')
  })
})

describe('extensionOf', () => {
  it('lowercases the extension', () => {
    expect(extensionOf('Words.DOCX')).toBe('docx')
  })

  it('is empty when there is no dot', () => {
    expect(extensionOf('words')).toBe('')
  })
})

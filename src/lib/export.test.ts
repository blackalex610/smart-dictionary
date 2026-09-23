import { describe, expect, it } from 'vitest'
import { csvCell } from './export'

describe('csvCell', () => {
  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"')
  })

  it.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx'])(
    'defuses spreadsheet formula injection in %j',
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true)
    },
  )

  it('leaves ordinary text alone', () => {
    expect(csvCell('ябълка')).toBe('"ябълка"')
  })
})

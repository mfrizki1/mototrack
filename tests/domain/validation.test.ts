import { describe, it, expect } from 'vitest'
import { parseKm, checkNewKm } from '../../src/domain/validation'

describe('parseKm', () => {
  it('strips Indonesian thousands separators', () => {
    expect(parseKm('12.500')).toBe(12500)
  })
  
  it('strips a "km" suffix and spaces', () => {
    expect(parseKm('12500 km')).toBe(12500)
  })
  
  it('accepts a plain integer', () => {
    expect(parseKm('8000')).toBe(8000)
  })
  
  it('returns null for non-numeric input', () => {
    expect(parseKm('abc')).toBeNull()
    expect(parseKm('')).toBeNull()
  })
})

describe('checkNewKm', () => {
  const lastLog = new Date('2026-06-10T08:00:00Z')
  const now = new Date('2026-06-13T08:00:00Z')

  it('accepts a normal increase', () => {
    expect(checkNewKm(10300, 10000, lastLog, now)).toEqual({ ok: true })
  })
  
  it('rejects a decrease', () => {
    expect(checkNewKm(9000, 10000, lastLog, now)).toEqual({ ok: false, reason: 'decrease' })
  })
  
  it('accepts equal km (no change)', () => {
    expect(checkNewKm(10000, 10000, lastLog, now)).toEqual({ ok: true })
  })
  
  it('flags a >5000 km jump within one day for confirmation', () => {
    const sameDay = new Date('2026-06-13T20:00:00Z')
    const lastToday = new Date('2026-06-13T08:00:00Z')
    expect(checkNewKm(16000, 10000, lastToday, sameDay)).toEqual({ ok: false, reason: 'jump', deltaKm: 6000 })
  })
 
  it('does NOT flag a >5000 km gain spread over more than a day', () => {
    expect(checkNewKm(16000, 10000, lastLog, now)).toEqual({ ok: true })
  })
})
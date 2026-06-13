// tests/domain/presets.test.ts

import { describe, it, expect } from 'vitest'
import { presetFor } from '../../src/domain/presets'

describe('presetFor', () => {
  it('includes the 6 common components for any type', () => {
    const keys = presetFor('SPORT').map(c => c.key)
    expect(keys).toEqual(
      expect.arrayContaining(['oli_mesin', 'busi', 'filter_udara', 'kampas_rem', 'minyak_rem', 'ban']),
    )
  })

  it('MATIC has matic-specific components and not manual ones', () => {
    const keys = presetFor('MATIC').map(c => c.key)
    expect(keys).toContain('v_belt')
    expect(keys).toContain('roller_cvt')
    expect(keys).toContain('oli_gardan')
    expect(keys).not.toContain('rantai_sprocket')
  })

  it('BEBEK and SPORT share manual components and exclude matic ones', () => {
    for (const t of ['BEBEK', 'SPORT'] as const) {
      const keys = presetFor(t).map(c => c.key)
      expect(keys).toContain('rantai_sprocket')
      expect(keys).toContain('oli_transmisi')
      expect(keys).not.toContain('v_belt')
    }
  })

  it('oli_mesin uses the conservative defaults 2500 km / 60 days', () => {
    const oli = presetFor('MATIC').find(c => c.key === 'oli_mesin')!
    expect(oli.intervalKm).toBe(2500)
    expect(oli.intervalDays).toBe(60)
  })

  it('kampas_rem is km-only at 5000 km', () => {
    const k = presetFor('BEBEK').find(c => c.key === 'kampas_rem')!
    expect(k.intervalKm).toBe(5000)
    expect(k.intervalDays).toBeNull()
  })
})
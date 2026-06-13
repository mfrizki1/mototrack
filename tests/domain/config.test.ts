import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  it('returns config when both vars are present', () => {
    expect(loadConfig({ BOT_TOKEN: 'abc', DATABASE_URL: 'postgres://x' })).toEqual({
      botToken: 'abc',
      databaseUrl: 'postgres://x',
    })
  })
  it('throws a clear error when BOT_TOKEN is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/BOT_TOKEN/)
  })
  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ BOT_TOKEN: 'abc' })).toThrow(/DATABASE_URL/)
  })
})

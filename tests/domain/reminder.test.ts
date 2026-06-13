import { describe, it, expect } from 'vitest'
import { evaluateComponent, checkMotor, daysBetween, type ComponentState } from '../../src/domain/reminder'

const base: ComponentState = {
  key: 'oli_mesin',
  name: 'Oli mesin',
  intervalKm: 2500,
  intervalDays: 60,
  lastServiceKm: 10000,
  lastServiceDate: new Date('2026-04-14T00:00:00Z'), // 60 days before "now" below
  lastNotifiedStage: 'NONE',
}
const now = new Date('2026-06-13T00:00:00Z')

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(new Date('2026-06-10T00:00:00Z'), new Date('2026-06-13T00:00:00Z'))).toBe(3)
  })
})

describe('evaluateComponent', () => {
  it('is NONE when far from both limits', () => {
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 10100, now)
    expect(ev.stage).toBe('NONE')
    expect(ev.sisaKm).toBe(2400)
  })
  it('is APPROACHING when km remaining <= 10% of interval', () => {
    // 2500 * 10% = 250 remaining -> currentKm = 10000 + 2250 = 12250
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 12250, now)
    expect(ev.stage).toBe('APPROACHING')
    expect(ev.sisaKm).toBe(250)
  })
  it('is APPROACHING when days remaining <= 7 even if km is fine', () => {
    // lastServiceDate 55 days ago, interval 60 -> 5 days left
    const ev = evaluateComponent(
      { ...base, lastServiceDate: new Date('2026-04-19T00:00:00Z') },
      10100,
      now,
    )
    expect(ev.stage).toBe('APPROACHING')
  })
  it('is OVERDUE when km consumed >= interval (takes precedence over approaching)', () => {
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 12500, now)
    expect(ev.stage).toBe('OVERDUE')
    expect(ev.sisaKm).toBe(0)
  })
  it('is OVERDUE when days consumed >= interval', () => {
    const ev = evaluateComponent(base, 10100, now) // 60 days elapsed, interval 60
    expect(ev.stage).toBe('OVERDUE')
  })
  it('ignores km when intervalKm is null', () => {
    const ev = evaluateComponent(
      { ...base, intervalKm: null, lastServiceDate: now },
      999999,
      now,
    )
    expect(ev.stage).toBe('NONE')
    expect(ev.sisaKm).toBeNull()
  })
})

describe('checkMotor', () => {
  it('notifies only when stage rank increases past lastNotifiedStage', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'NONE' }, // -> APPROACHING at 12250 -> notify
      { ...base, key: 'busi', name: 'Busi', intervalKm: 6000, intervalDays: null,
        lastServiceDate: now, lastNotifiedStage: 'APPROACHING' }, // still far -> NONE, no notify
    ]
    const checks = checkMotor(components, 12250, now)
    expect(checks.find(c => c.evaluation.key === 'oli_mesin')!.shouldNotify).toBe(true)
    expect(checks.find(c => c.evaluation.key === 'busi')!.shouldNotify).toBe(false)
  })

  it('does not re-notify a component already at the same stage', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'APPROACHING' },
    ]
    const checks = checkMotor(components, 12250, now) // computes APPROACHING
    expect(checks[0].shouldNotify).toBe(false)
  })

  it('fires the second ping on APPROACHING -> OVERDUE', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'APPROACHING' },
    ]
    const checks = checkMotor(components, 12500, now) // OVERDUE
    expect(checks[0].shouldNotify).toBe(true)
  })
})
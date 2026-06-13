import { describe, it, expect } from 'vitest'
import { buildReminderMessage } from '../../src/scheduler/notify'
import type { Evaluation } from '../../src/domain/reminder'

const approaching: Evaluation = { key: 'oli_mesin', name: 'Oli mesin', stage: 'APPROACHING', sisaKm: 250, sisaHari: 40 }
const overdue: Evaluation = { key: 'ban', name: 'Ban', stage: 'OVERDUE', sisaKm: -100, sisaHari: null }

describe('buildReminderMessage', () => {
  it('lists each due component with its name', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg).toContain('Vario 125')
    expect(msg).toContain('Oli mesin')
    expect(msg).toContain('Ban')
  })
  it('marks overdue components distinctly from approaching ones', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg).toContain('Mendekati')
    expect(msg).toContain('LEWAT JADWAL')
  })
  it('combines multiple components into a single message that points to /catat_servis', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg.match(/\/catat_servis/g)!.length).toBe(1)
  })
})
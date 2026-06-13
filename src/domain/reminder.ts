export type NotifyStage = 'NONE' | 'APPROACHING' | 'OVERDUE'

export interface ComponentState {
  key: string
  name: string
  intervalKm: number | null
  intervalDays: number | null
  lastServiceKm: number
  lastServiceDate: Date
  lastNotifiedStage: NotifyStage
}

export interface Evaluation {
  key: string
  name: string
  stage: NotifyStage
  sisaKm: number | null
  sisaHari: number | null
}

export interface ComponentCheck {
  evaluation: Evaluation
  shouldNotify: boolean
}

const KM_LEAD = 0.1
const DAYS_LEAD = 7
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const RANK: Record<NotifyStage, number> = { NONE: 0, APPROACHING: 1, OVERDUE: 2 }

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / ONE_DAY_MS)
}

export function evaluateComponent(c: ComponentState, currentKm: number, now: Date): Evaluation {
  const sisaKm = c.intervalKm == null ? null : c.intervalKm - (currentKm - c.lastServiceKm)
  const sisaHari = c.intervalDays == null ? null : c.intervalDays - daysBetween(c.lastServiceDate, now)

  const overdue =
    (c.intervalKm != null && sisaKm! <= 0) ||
    (c.intervalDays != null && sisaHari! <= 0)
  const approaching =
    (c.intervalKm != null && sisaKm! <= c.intervalKm * KM_LEAD) ||
    (c.intervalDays != null && sisaHari! <= DAYS_LEAD)

  const stage: NotifyStage = overdue ? 'OVERDUE' : approaching ? 'APPROACHING' : 'NONE'
  return { key: c.key, name: c.name, stage, sisaKm, sisaHari }
}

export function checkMotor(components: ComponentState[], currentKm: number, now: Date): ComponentCheck[] {
  return components.map((c) => {
    const evaluation = evaluateComponent(c, currentKm, now)
    return { evaluation, shouldNotify: RANK[evaluation.stage] > RANK[c.lastNotifiedStage] }
  })
}
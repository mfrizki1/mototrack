const ONE_DAY_MS = 24 * 60 * 60 * 1000
const JUMP_LIMIT_KM = 5000

export function parseKm(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits === '') return null
  const n = Number(digits)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export type KmCheck =
  | { ok: true }
  | { ok: false; reason: 'decrease' }
  | { ok: false; reason: 'jump'; deltaKm: number }

export function checkNewKm(
  newKm: number,
  currentKm: number,
  lastLogAt: Date,
  now: Date
): KmCheck {
  if (newKm < currentKm) {
    return { ok: false, reason: 'decrease' }
  }

  const delta = newKm - currentKm
  const withinOneDay = now.getTime() - lastLogAt.getTime() <= ONE_DAY_MS

  if (withinOneDay && delta > JUMP_LIMIT_KM) {
    return { ok: false, reason: 'jump', deltaKm: delta }
  }

  return { ok: true }
}
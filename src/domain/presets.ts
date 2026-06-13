export type MotorType = 'MATIC' | 'BEBEK' | 'SPORT'

export interface ComponentPreset {
  key: string
  name: string
  intervalKm: number | null
  intervalDays: number | null
}

const COMMON: ComponentPreset[] = [
  { key: 'oli_mesin', name: 'Oli mesin', intervalKm: 2500, intervalDays: 60 },
  { key: 'busi', name: 'Busi', intervalKm: 6000, intervalDays: null },
  { key: 'filter_udara', name: 'Filter udara', intervalKm: 8000, intervalDays: null },
  { key: 'kampas_rem', name: 'Kampas rem', intervalKm: 5000, intervalDays: null },
  { key: 'minyak_rem', name: 'Minyak rem', intervalKm: 40000, intervalDays: 730 },
  { key: 'ban', name: 'Ban', intervalKm: 40000, intervalDays: 1095 },
]

const MATIC: ComponentPreset[] = [
  { key: 'oli_gardan', name: 'Oli gardan', intervalKm: 8000, intervalDays: 240 },
  { key: 'v_belt', name: 'V-belt', intervalKm: 20000, intervalDays: 730 },
  { key: 'roller_cvt', name: 'Roller CVT', intervalKm: 20000, intervalDays: null },
]

const MANUAL: ComponentPreset[] = [
  { key: 'rantai_sprocket', name: 'Rantai & sprocket', intervalKm: 12000, intervalDays: null },
  { key: 'oli_transmisi', name: 'Oli transmisi', intervalKm: 8000, intervalDays: 240 },
]

export function presetFor(type: MotorType): ComponentPreset[] {
  const specific = type === 'MATIC' ? MATIC : MANUAL
  return [...COMMON, ...specific]
}
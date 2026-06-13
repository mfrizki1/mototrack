import { prisma } from './db'
import { presetFor, type MotorType } from './domain/presets'
import type { ComponentState } from './domain/reminder'

export async function ensureUser(telegramId: bigint, name?: string) {
  return prisma.user.upsert({
    where: { telegramId },
    update: {},
    create: { telegramId, name },
  })
}

export async function getMotorByTelegramId(telegramId: bigint) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { motors: { include: { components: true }, take: 1 } },
  })
  return user?.motors[0] ?? null
}

export async function createMotorWithPresets(
  userId: number,
  name: string,
  type: MotorType,
  initialKm: number,
  now: Date,
) {
  return prisma.motor.create({
    data: {
      userId,
      name,
      type,
      initialKm,
      currentKm: initialKm,
      registeredAt: now,
      components: {
        create: presetFor(type).map((p) => ({
          key: p.key,
          name: p.name,
          intervalKm: p.intervalKm,
          intervalDays: p.intervalDays,
          lastServiceKm: initialKm,
          lastServiceDate: now,
        })),
      },
    },
    include: { components: true },
  })
}

export async function addKmLog(motorId: number, km: number) {
  await prisma.kmLog.create({ data: { motorId, km } })
  await prisma.motor.update({ where: { id: motorId }, data: { currentKm: km } })
}

export async function resetComponents(motorId: number, componentIds: number[], km: number, date: Date) {
  for (const componentId of componentIds) {
    await prisma.component.update({
      where: { id: componentId },
      data: { lastServiceKm: km, lastServiceDate: date, lastNotifiedStage: 'NONE' },
    })
    await prisma.serviceLog.create({ data: { motorId, componentId, km, date } })
  }
}

export async function setComponentInterval(componentId: number, intervalKm: number | null, intervalDays: number | null) {
  await prisma.component.update({ where: { id: componentId }, data: { intervalKm, intervalDays } })
}

// Map a Prisma component row to the pure ComponentState used by the domain.
export function toComponentState(c: {
  key: string; name: string; intervalKm: number | null; intervalDays: number | null
  lastServiceKm: number; lastServiceDate: Date; lastNotifiedStage: string
}): ComponentState {
  return {
    key: c.key,
    name: c.name,
    intervalKm: c.intervalKm,
    intervalDays: c.intervalDays,
    lastServiceKm: c.lastServiceKm,
    lastServiceDate: c.lastServiceDate,
    lastNotifiedStage: c.lastNotifiedStage as ComponentState['lastNotifiedStage'],
  }
}

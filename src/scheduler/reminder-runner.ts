import type { Api } from 'grammy'
import { prisma } from '../db'
import { checkMotor } from '../domain/reminder'
import { toComponentState } from '../data'
import { buildReminderMessage } from './notify'

interface MotorForCheck {
  id: number
  name: string
  currentKm: number
  user: { telegramId: bigint }
  components: {
    id: number
    key: string
    name: string
    intervalKm: number | null
    intervalDays: number | null
    lastServiceKm: number
    lastServiceDate: Date
    lastNotifiedStage: string
  }[]
}

export async function runReminderCheck(api: Api, motor: MotorForCheck, now: Date = new Date()): Promise<void> {
  const states = motor.components.map(toComponentState)
  const checks = checkMotor(states, motor.currentKm, now)

  // Persist the freshly computed stage for every component (keeps stage in sync up AND down).
  await Promise.all(
    checks.map((ch, i) =>
      prisma.component.update({
        where: { id: motor.components[i].id },
        data: { lastNotifiedStage: ch.evaluation.stage },
      }),
    ),
  )

  const due = checks.filter((c) => c.shouldNotify).map((c) => c.evaluation)
  if (due.length > 0) {
    await api.sendMessage(Number(motor.user.telegramId), buildReminderMessage(motor.name, due), {
      parse_mode: 'HTML',
    })
  }
}

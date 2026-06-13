import cron from 'node-cron'
import type { Api } from 'grammy'
import { prisma } from '../db'
import { runReminderCheck } from './reminder-runner'

export function startDailyReminders(api: Api): void {
  cron.schedule('0 7 * * *', async () => {
    const motors = await prisma.motor.findMany({
      include: { components: true, user: true },
    })
    await Promise.allSettled(motors.map((m) => runReminderCheck(api, m)))
  })
}

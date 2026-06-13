import type { Bot } from 'grammy'
import type { MyContext } from '../context'
import { prisma } from '../db'
import { getMotorByTelegramId } from '../data'

export function registerRiwayat(bot: Bot<MyContext>): void {
  bot.command('riwayat', async (ctx) => {
    const motor = await getMotorByTelegramId(BigInt(ctx.from!.id))
    if (!motor) return ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')

    const [services, kms] = await Promise.all([
      prisma.serviceLog.findMany({
        where: { motorId: motor.id },
        orderBy: { date: 'desc' },
        take: 10,
        include: { component: true },
      }),
      prisma.kmLog.findMany({ where: { motorId: motor.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ])

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const svcLines = services.length
      ? services.map((s) => `• ${fmt(s.date)} — ${s.component.name} @ ${s.km} km`).join('\n')
      : 'Belum ada riwayat servis.'
    const kmLines = kms.length
      ? kms.map((k) => `• ${fmt(k.createdAt)} — ${k.km} km`).join('\n')
      : 'Belum ada catatan km.'

    await ctx.reply(`<b>Riwayat servis:</b>\n${svcLines}\n\n<b>Catatan km terakhir:</b>\n${kmLines}`, {
      parse_mode: 'HTML',
    })
  })
}

import type { Bot } from 'grammy'
import type { MyContext } from '../context'
import { getMotorByTelegramId, toComponentState } from '../data'
import { evaluateComponent } from '../domain/reminder'

export function registerStatus(bot: Bot<MyContext>): void {
  bot.command('status', async (ctx) => {
    const motor = await getMotorByTelegramId(BigInt(ctx.from!.id))
    if (!motor) return ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')

    const now = new Date()
    const lines = motor.components.map((c) => {
      const ev = evaluateComponent(toComponentState(c), motor.currentKm, now)
      const bits: string[] = []
      if (ev.sisaKm != null) bits.push(ev.sisaKm <= 0 ? `lewat ${-ev.sisaKm} km` : `${ev.sisaKm} km lagi`)
      if (ev.sisaHari != null) bits.push(ev.sisaHari <= 0 ? `lewat ${-ev.sisaHari} hari` : `${ev.sisaHari} hari lagi`)
      const icon = ev.stage === 'OVERDUE' ? '⚠️' : ev.stage === 'APPROACHING' ? '🔔' : '✅'
      return `${icon} ${c.name}: ${bits.join(', ') || '—'}`
    })

    await ctx.reply(
      `*${motor.name}* — ${motor.currentKm} km\n\n` + lines.join('\n'),
      { parse_mode: 'Markdown' },
    )
  })
}

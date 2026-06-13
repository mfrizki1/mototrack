import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { MyContext } from '../context'
import { getMotorByTelegramId, setComponentInterval } from '../data'

export async function setInterval(
  conversation: Conversation<MyContext, Context>,
  ctx: Context,
): Promise<void> {
  const motor = await conversation.external(() =>
    getMotorByTelegramId(BigInt(ctx.from!.id)),
  )
  if (!motor) {
    await ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')
    return
  }

  // Build component selection keyboard
  const kb = new InlineKeyboard()
  for (const c of motor.components) {
    kb.text(c.name, `si:${c.id}`).row()
  }
  await ctx.reply('Pilih komponen yang ingin diubah intervalnya:', { reply_markup: kb })

  const pick = await conversation.waitForCallbackQuery(/^si:(\d+)$/)
  await pick.answerCallbackQuery()
  const componentId = Number(pick.match[1])
  const component = motor.components.find((c) => c.id === componentId)
  if (!component) return

  await ctx.reply(
    `Komponen: *${component.name}*\nInterval saat ini: ${component.intervalKm ?? '—'} km / ${component.intervalDays ?? '—'} hari\n\nMasukkan interval km baru (atau ketik "-" untuk tidak ubah):`,
    { parse_mode: 'Markdown' },
  )

  let newKm: number | null = null
  let newDays: number | null = null

  const kmMsg = await conversation.waitFor('message:text')
  const rawKm = kmMsg.message.text.trim()
  if (rawKm !== '-') {
    const parsed = parseInt(rawKm.replace(/\./g, ''), 10)
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply('Input tidak valid. Interval tidak diubah.')
      return
    }
    newKm = parsed
  }

  await ctx.reply('Masukkan interval hari baru (atau ketik "-" untuk tidak ubah):')
  const daysMsg = await conversation.waitFor('message:text')
  const rawDays = daysMsg.message.text.trim()
  if (rawDays !== '-') {
    const parsed = parseInt(rawDays, 10)
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply('Input tidak valid. Interval tidak diubah.')
      return
    }
    newDays = parsed
  }

  if (newKm === null && newDays === null) {
    await ctx.reply('Tidak ada perubahan.')
    return
  }

  await conversation.external(() =>
    setComponentInterval(componentId, newKm, newDays),
  )

  const parts: string[] = []
  if (newKm !== null) parts.push(`${newKm} km`)
  if (newDays !== null) parts.push(`${newDays} hari`)
  await ctx.reply(`Interval *${component.name}* diperbarui: ${parts.join(' / ')}.`, {
    parse_mode: 'Markdown',
  })
}

export function registerSetInterval(bot: Bot<MyContext>): void {
  bot.command('set_interval', async (ctx) => {
    await ctx.conversation.enter('setInterval')
  })
}

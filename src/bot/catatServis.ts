import { InlineKeyboard, type Bot } from 'grammy'
import type { MyContext } from '../context'
import { getMotorByTelegramId, resetComponents } from '../data'

function componentKeyboard(components: { id: number; name: string }[]): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const c of components) kb.text(c.name, `srv:${c.id}`).row()
  kb.text('✅ Selesai', 'srv_done')
  return kb
}

export function registerCatatServis(bot: Bot<MyContext>): void {
  bot.command('catat_servis', async (ctx) => {
    const motor = await getMotorByTelegramId(BigInt(ctx.from!.id))
    if (!motor) return ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')
    await ctx.reply(
      `Pilih komponen yang dicek/diganti (km servis = ${motor.currentKm} km), lalu tekan Selesai:`,
      { reply_markup: componentKeyboard(motor.components) },
    )
  })

  bot.callbackQuery(/^srv:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Dipilih ✓')
    const id = ctx.match[1]
    const kb = ctx.callbackQuery.message?.reply_markup
    if (!kb) return
    const next = new InlineKeyboard()
    for (const row of kb.inline_keyboard) {
      for (const btn of row) {
        if ('callback_data' in btn && btn.callback_data) {
          const chosen = btn.callback_data === `srv:${id}`
          const already = btn.text.startsWith('✓ ')
          const isThisRow = btn.callback_data.startsWith('srv:')
          const text = isThisRow && (chosen ? !already : already)
            ? (already ? btn.text.slice(2) : `✓ ${btn.text}`)
            : btn.text
          next.text(text, btn.callback_data)
        }
      }
      next.row()
    }
    await ctx.editMessageReplyMarkup({ reply_markup: next })
  })

  bot.callbackQuery('srv_done', async (ctx) => {
    await ctx.answerCallbackQuery()
    const motor = await getMotorByTelegramId(BigInt(ctx.from.id))
    if (!motor) return
    const kb = ctx.callbackQuery.message?.reply_markup
    const chosenIds: number[] = []
    for (const row of kb?.inline_keyboard ?? []) {
      for (const btn of row) {
        if ('callback_data' in btn && btn.callback_data?.startsWith('srv:') && btn.text.startsWith('✓ ')) {
          chosenIds.push(Number(btn.callback_data.split(':')[1]))
        }
      }
    }
    if (chosenIds.length === 0) {
      return ctx.editMessageText('Tidak ada komponen dipilih. Servis tidak dicatat.')
    }
    await resetComponents(motor.id, chosenIds, motor.currentKm, new Date())
    const names = motor.components.filter((c) => chosenIds.includes(c.id)).map((c) => c.name)
    await ctx.editMessageText(`Servis dicatat untuk: ${names.join(', ')}. Hitungan direset.`)
  })
}

import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { MyContext } from '../context'
import type { MotorType } from '../domain/presets'
import { parseKm } from '../domain/validation'
import { ensureUser, getMotorByTelegramId, createMotorWithPresets } from '../data'
import { esc } from '../html'

export async function daftarMotor(conversation: Conversation<MyContext, Context>, ctx: Context): Promise<void> {
  const from = ctx.from!
  const existing = await conversation.external(() => getMotorByTelegramId(BigInt(from.id)))
  if (existing) {
    await ctx.reply('Kamu sudah punya motor terdaftar. Multi-motor belum didukung.')
    return
  }

  await ctx.reply('Nama / merk motormu? (contoh: Vario 125)')
  const nameMsg = await conversation.waitFor('message:text')
  const name = nameMsg.message.text.trim()

  const kb = new InlineKeyboard()
    .text('Matic', 'MATIC').text('Bebek', 'BEBEK').text('Sport', 'SPORT')
  await ctx.reply('Pilih jenis motor:', { reply_markup: kb })
  const typeCtx = await conversation.waitForCallbackQuery(['MATIC', 'BEBEK', 'SPORT'])
  const type = typeCtx.callbackQuery.data as MotorType
  await typeCtx.answerCallbackQuery()

  await ctx.reply('Berapa km motormu sekarang? (contoh: 12500)')
  let km: number | null = null
  while (km === null) {
    const kmMsg = await conversation.waitFor('message:text')
    km = parseKm(kmMsg.message.text)
    if (km === null) await ctx.reply('Format km tidak valid. Masukkan angka, contoh: 12500')
  }

  const now = new Date()
  await conversation.external(async () => {
    const user = await ensureUser(BigInt(from.id), from.first_name)
    await createMotorWithPresets(user.id, name, type, km!, now)
  })

  await ctx.reply(
    `Motor <b>${esc(name)}</b> (${type}) terdaftar dengan ${km} km. ` +
      `Interval komponen sudah aktif otomatis.\n\nCek dengan /status.`,
    { parse_mode: 'HTML' },
  )
}

export function registerDaftarMotor(bot: Bot<MyContext>): void {
  bot.command('daftar_motor', async (ctx) => {
    await ctx.conversation.enter('daftarMotor')
  })
}

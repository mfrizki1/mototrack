import { InlineKeyboard, type Bot } from 'grammy'
import type { MyContext } from '../context'
import { parseKm, checkNewKm } from '../domain/validation'
import { prisma } from '../db'
import { getMotorByTelegramId, addKmLog } from '../data'
import { runReminderCheck } from '../scheduler/reminder-runner'

async function saveAndRemind(ctx: MyContext, motorId: number, km: number) {
  await addKmLog(motorId, km)
  const motor = await prisma.motor.findUnique({
    where: { id: motorId },
    include: { user: true, components: true },
  })
  if (motor) await runReminderCheck(ctx.api, motor, new Date())
}

export function registerCatatKm(bot: Bot<MyContext>): void {
  bot.command('catat_km', async (ctx) => {
    const motor = await getMotorByTelegramId(BigInt(ctx.from!.id))
    if (!motor) return ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')

    const arg = ctx.match.trim()
    const km = parseKm(arg)
    if (km === null) {
      return ctx.reply('Kirim: /catat_km <angka>. Contoh: /catat_km 12500')
    }

    const lastLog = await prisma.kmLog.findFirst({
      where: { motorId: motor.id },
      orderBy: { createdAt: 'desc' },
    })
    const lastLogAt = lastLog?.createdAt ?? motor.registeredAt
    const verdict = checkNewKm(km, motor.currentKm, lastLogAt, new Date())

    if (!verdict.ok && verdict.reason === 'decrease') {
      return ctx.reply(`Km baru (${km}) lebih kecil dari catatan terakhir (${motor.currentKm}). Ditolak.`)
    }
    if (!verdict.ok && verdict.reason === 'jump') {
      const kb = new InlineKeyboard().text('Ya, benar', `km_ok:${km}`).text('Batal', 'km_cancel')
      return ctx.reply(
        `Lonjakan ${verdict.deltaKm} km dalam sehari terlihat tidak wajar. Yakin?`,
        { reply_markup: kb },
      )
    }

    await saveAndRemind(ctx, motor.id, km)
    await ctx.reply(`Tercatat: ${km} km.`)
  })

  bot.callbackQuery(/^km_ok:(\d+)$/, async (ctx) => {
    const km = Number(ctx.match[1])
    const motor = await getMotorByTelegramId(BigInt(ctx.from.id))
    await ctx.answerCallbackQuery()
    if (!motor) return
    await saveAndRemind(ctx, motor.id, km)
    await ctx.editMessageText(`Tercatat: ${km} km.`)
  })

  bot.callbackQuery('km_cancel', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText('Dibatalkan.')
  })
}

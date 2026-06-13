import 'dotenv/config'
import { Bot } from 'grammy'
import { conversations, createConversation } from '@grammyjs/conversations'
import { loadConfig } from './config'
import type { MyContext } from './context'
import { registerStart } from './bot/start'
import { daftarMotor, registerDaftarMotor } from './bot/daftarMotor'
import { registerCatatKm } from './bot/catatKm'
import { registerStatus } from './bot/status'
import { registerCatatServis } from './bot/catatServis'
import { setInterval as setIntervalConv, registerSetInterval } from './bot/setInterval'
import { registerRiwayat } from './bot/riwayat'
import { startDailyReminders } from './scheduler/cron'

const config = loadConfig()
export const bot = new Bot<MyContext>(config.botToken)

bot.use(conversations())
bot.use(createConversation(daftarMotor, { id: 'daftarMotor', maxMillisecondsToWait: 5 * 60 * 1000 }))
bot.use(createConversation(setIntervalConv, { id: 'setInterval', maxMillisecondsToWait: 5 * 60 * 1000 }))

const ownerId = process.env.OWNER_ID ? BigInt(process.env.OWNER_ID) : null
if (ownerId !== null) {
  bot.use((ctx, next) => {
    if (ctx.from && BigInt(ctx.from.id) === ownerId) return next()
    return Promise.resolve()
  })
}

registerStart(bot)
registerDaftarMotor(bot)
registerCatatKm(bot)
registerStatus(bot)
registerCatatServis(bot)
registerSetInterval(bot)
registerRiwayat(bot)

bot.catch((err) => {
  console.error('Bot error:', err.error)
})

if (import.meta.url === `file://${process.argv[1]}`) {
  bot.api.setMyCommands([
    { command: 'daftar_motor', description: 'Daftarkan motor baru' },
    { command: 'catat_km', description: 'Perbarui kilometer motor' },
    { command: 'status', description: 'Lihat status servis tiap komponen' },
    { command: 'catat_servis', description: 'Catat komponen yang sudah diservis' },
    { command: 'set_interval', description: 'Ubah interval servis komponen' },
    { command: 'riwayat', description: 'Riwayat km & servis' },
  ])
  startDailyReminders(bot.api)
  bot.start()
  console.log('MotoTrack bot started (polling).')
}

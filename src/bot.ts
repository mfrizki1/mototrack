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

const config = loadConfig()
export const bot = new Bot<MyContext>(config.botToken)

bot.use(conversations())
bot.use(createConversation(daftarMotor, 'daftarMotor'))
bot.use(createConversation(setIntervalConv, 'setInterval'))

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
  bot.start()
  console.log('MotoTrack bot started (polling).')
}

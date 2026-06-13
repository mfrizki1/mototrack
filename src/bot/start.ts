import type { Bot } from 'grammy'
import type { MyContext } from '../context'
import { ensureUser } from '../data'

const WELCOME = [
  '<b>Selamat datang di MotoTrack 🏍️</b>',
  '',
  'Bot ini membantu mencatat servis motormu dan mengingatkan saat waktunya perawatan.',
  '',
  'Mulai dengan /daftar_motor untuk mendaftarkan motormu.',
  '',
  'Perintah lain:',
  '/catat_km — perbarui kilometer',
  '/status — lihat sisa km per komponen',
  '/catat_servis — catat servis',
  '/set_interval — ubah interval komponen',
  '/riwayat — riwayat km &amp; servis',
].join('\n')

export function registerStart(bot: Bot<MyContext>): void {
  bot.command('start', async (ctx) => {
    if (ctx.from) await ensureUser(BigInt(ctx.from.id), ctx.from.first_name)
    await ctx.reply(WELCOME, { parse_mode: 'HTML' })
  })
}

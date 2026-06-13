import type { Evaluation } from '../domain/reminder'
import { esc } from '../html'

export function buildReminderMessage(motorName: string, due: Evaluation[]): string {
  const lines = due.map((d) => {
    const label = d.stage === 'OVERDUE' ? '⚠️ LEWAT JADWAL' : '🔔 Mendekati'
    const parts: string[] = []
    if (d.sisaKm != null) parts.push(d.sisaKm <= 0 ? `lewat ${-d.sisaKm} km` : `sisa ${d.sisaKm} km`)
    if (d.sisaHari != null) parts.push(d.sisaHari <= 0 ? `lewat ${-d.sisaHari} hari` : `sisa ${d.sisaHari} hari`)
    return `${label} — ${d.name} (${parts.join(', ')})`
  })
  return (
    `Pengingat servis untuk <b>${esc(motorName)}</b>:\n` +
    lines.join('\n') +
    `\n\nSudah servis? Catat dengan /catat_servis`
  )
}
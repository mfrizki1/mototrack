# MotoTrack MVP — Desain & Spesifikasi

**Produk:** MotoTrack — Bot Telegram manajemen servis & perawatan motor
**Dokumen:** Desain teknis MVP (turunan dari PRD v1.1)
**Tanggal:** 13 Juni 2026
**Status:** Disetujui untuk perencanaan implementasi

> Catatan bahasa: dokumen ini ditulis dalam Bahasa Indonesia agar mudah ditinjau.
> Istilah teknis (nama tabel, tipe, fungsi) memakai bahasa Inggris sesuai konvensi kode.
> Seluruh teks yang ditampilkan bot ke pengguna berbahasa Indonesia.

---

## 1. Ringkasan

MotoTrack adalah bot Telegram yang membantu pemilik motor mencatat riwayat perawatan
dan menerima pengingat servis otomatis berbasis odometer manual. Pengguna mencatat
angka kilometer secara berkala; bot menghitung kapan tiap komponen jatuh tempo servis
(berbasis km dan/atau waktu) dan mengingatkan secara proaktif.

Dokumen ini mempersempit PRD menjadi keputusan teknis konkret untuk MVP.

---

## 2. Keputusan teknis (terkunci)

| Aspek | Keputusan | Alasan singkat |
|---|---|---|
| Bahasa & framework | **Node.js + grammY (TypeScript)** | Ketik aman (TS), plugin `conversations` untuk alur bertahap, ergonomis untuk inline keyboard |
| Database | **PostgreSQL + Prisma (ORM)** | Relasional (user→motor→komponen→log), query bertipe, sama dev→prod |
| Arsitektur | **Monolit satu proses** | Bot (long-polling) + `node-cron` dalam satu proses; modul scheduler diisolasi agar mudah dipisah nanti |
| Mode update | **Long-polling** di dev; siap pindah **webhook** via config di produksi | Tanpa URL publik saat dev = nol infrastruktur |
| Lingkup motor | **Satu motor per user** (skema sudah multi-ready lewat FK) | Mengurangi friksi UX; multi-motor = fase berikutnya tanpa rombak skema |
| Bahasa bot | **Bahasa Indonesia** | Sesuai target pengguna PRD |

---

## 3. Lingkup MVP

### Termasuk
- Pendaftaran satu motor (nama, jenis: matic/bebek/sport, km awal).
- Preset interval komponen otomatis berdasarkan jenis motor.
- Pengaturan interval per-komponen (km dan/atau waktu).
- Pencatatan km odometer berkala (manual) + validasi.
- Mesin pengingat per-komponen (dua trigger: saat catat km, dan cron harian).
- Pencatatan riwayat servis per-komponen.
- Riwayat km & servis.

### Tidak termasuk (Phase-2, sengaja ditunda agar MVP ramping)
- Pengingat km "lembut" berkala ("Berapa km motormu?").
- Cek ketegangan rantai tiap 2.000 km.
- Multi-motor (statistik, perbandingan).
- Per-user timezone (MVP berasumsi WIB).
- Reset odometer / ganti motor (km mundur secara sah, mis. ganti speedometer).
- Integration test berinfrastruktur (Postgres test) — MVP fokus unit test pada domain murni.
- Pelacakan otomatis (Live Location), foto struk, dashboard web.

---

## 4. Data model (Prisma)

```prisma
model User {
  id         Int      @id @default(autoincrement())
  telegramId BigInt   @unique
  name       String?
  createdAt  DateTime @default(now())
  motors     Motor[]
}

model Motor {
  id           Int         @id @default(autoincrement())
  userId       Int
  user         User        @relation(fields: [userId], references: [id])
  name         String
  type         MotorType
  initialKm    Int
  currentKm    Int
  registeredAt DateTime    @default(now())
  components   Component[]
  serviceLogs  ServiceLog[]
  kmLogs       KmLog[]
}

model Component {
  id                Int          @id @default(autoincrement())
  motorId           Int
  motor             Motor        @relation(fields: [motorId], references: [id])
  key               String       // mis. "oli_mesin", "v_belt" (stabil utk logika)
  name              String       // label tampil, mis. "Oli mesin"
  intervalKm        Int?
  intervalDays      Int?
  lastServiceKm     Int          // diisi km motor saat komponen terakhir di-reset
  lastServiceDate   DateTime
  lastNotifiedStage NotifyStage  @default(NONE)
  serviceLogs       ServiceLog[]
}

model ServiceLog {
  id          Int       @id @default(autoincrement())
  motorId     Int
  motor       Motor     @relation(fields: [motorId], references: [id])
  componentId Int
  component   Component @relation(fields: [componentId], references: [id])
  date        DateTime  @default(now())
  km          Int
  note        String?
}

model KmLog {
  id        Int      @id @default(autoincrement())
  motorId   Int
  motor     Motor    @relation(fields: [motorId], references: [id])
  km        Int
  createdAt DateTime @default(now())
}

enum MotorType { MATIC BEBEK SPORT }
enum NotifyStage { NONE APPROACHING OVERDUE }
```

**Catatan denormalisasi (disengaja):**
- `Motor.currentKm` menyimpan km terbaru (duplikat dari `KmLog` terakhir) → `/status` cepat tanpa query agregat.
- `Component.lastServiceKm` / `lastServiceDate` (turunan dari `ServiceLog` terakhir) → evaluasi mesin pengingat cepat tanpa agregasi per pengecekan.

Saat pendaftaran motor, baris `Component` di-seed sesuai jenis motor (lihat §6).

---

## 5. Mesin pengingat

Lokasi: `src/domain/reminder.ts` — **fungsi murni, tanpa I/O, diuji unit**.

### 5.1 Satu fungsi, dua trigger
Satu fungsi `checkMotor()` mengevaluasi **km dan hari sekaligus** untuk setiap komponen.
Trigger hanya menentukan *kapan* fungsi dipanggil, bukan logikanya:

1. **Saat `/catat_km`** — setelah km tersimpan, jalankan `checkMotor()`.
2. **Cron harian** — pukul 09:00 WIB, `node-cron` dengan `{ timezone: 'Asia/Jakarta' }` eksplisit; jalankan `checkMotor()` untuk semua motor (menangkap jatuh tempo berbasis waktu).

> Keduanya mengevaluasi km + hari, sehingga tidak ada jatuh tempo yang lolos karena
> "salah trigger".

### 5.2 Perhitungan per komponen
```
sisaKm   = intervalKm   - (currentKm - lastServiceKm)        // bila intervalKm ada
sisaHari = intervalDays - (hariIni   - lastServiceDate)      // bila intervalDays ada
```

### 5.3 Stage
- **APPROACHING** bila `sisaKm <= 10% * intervalKm` **ATAU** `sisaHari <= 7`.
- **OVERDUE** bila `currentKm - lastServiceKm >= intervalKm` **ATAU** `hariIni - lastServiceDate >= intervalDays`.
- Komponen tanpa `intervalKm` mengabaikan syarat km; tanpa `intervalDays` mengabaikan syarat waktu.

**Urutan evaluasi (presedensi):** cek **OVERDUE dulu**, baru **APPROACHING**, baru **NONE**.
Karena saat `sisaKm <= 0` kondisi APPROACHING juga benar, stage = tingkat tertinggi yang tercapai.

> Lead km = **10% interval**; lead waktu = **tetap 7 hari** (bukan persentase —
> 10% dari 730 hari = 73 hari terlalu dini).

### 5.4 Dedup notifikasi (dua ping)
`Component.lastNotifiedStage` mencegah spam dan memberi **dua pengingat** per siklus:
- Naik `NONE → APPROACHING`: kirim ping pertama ("mendekati jadwal").
- Naik `APPROACHING → OVERDUE`: kirim ping kedua ("sudah lewat jadwal").
- Bot **tidak** mengirim ulang untuk stage yang sama.
- Saat `/catat_servis` me-reset komponen, `lastNotifiedStage` kembali ke `NONE`.
- Bila pengguna menaikkan interval via `/set_interval`, evaluasi ulang otomatis
  menurunkan stage bila perlu.

### 5.5 Pesan gabungan
Bila beberapa komponen jatuh tempo pada satu evaluasi, kirim **satu pesan gabungan**
(daftar komponen), bukan notifikasi terpisah (mitigasi risiko PRD "notifikasi terlalu banyak").

### 5.6 Kasus khusus kampas rem
Kampas rem tidak punya interval ganti pasti — PRD: "notif setiap 5.000 km".
Dimodelkan sebagai komponen biasa dengan `intervalKm = 5000`, `intervalDays = null`,
yang **reset tiap kali dicatat** lewat `/catat_servis` (mekanik identik dengan komponen
ganti). Teks bot memakai kata "dicek/diganti" untuk kampas rem (bukan hanya "diganti").

---

## 6. Preset interval per jenis motor

Nilai default memakai **batas konservatif** (mengingatkan lebih awal = lebih kecil
risiko telat servis). Semua dapat diubah via `/set_interval`.

| Komponen (`key`) | intervalKm | intervalDays | Jenis motor |
|---|---|---|---|
| Oli mesin (`oli_mesin`) | 2.500 | 60 | semua |
| Busi (`busi`) | 6.000 | — | semua |
| Filter udara (`filter_udara`) | 8.000 | — | semua |
| Kampas rem (`kampas_rem`) | 5.000 | — | semua |
| Minyak rem (`minyak_rem`) | 40.000 | 730 | semua |
| Ban (`ban`) | 40.000 | 1.095 | semua |
| Oli gardan (`oli_gardan`) | 8.000 | 240 | matic |
| V-belt (`v_belt`) | 20.000 | 730 | matic |
| Roller CVT (`roller_cvt`) | 20.000 | — | matic |
| Rantai & sprocket (`rantai_sprocket`) | 12.000 | — | bebek/sport |
| Oli transmisi (`oli_transmisi`) | 8.000 | 240 | bebek/sport |

Saat pendaftaran: seed = komponen "semua" + komponen sesuai jenis motor.
`lastServiceKm` awal = `initialKm`; `lastServiceDate` awal = tanggal daftar.

Definisi preset disimpan di `src/domain/presets.ts` (data + fungsi `presetFor(type)`),
diuji unit.

---

## 7. Validasi odometer

Lokasi: `src/domain/validation.ts` — **fungsi murni, diuji unit**.

1. **Normalisasi input** — `parseKm(raw)` membuang pemisah ribuan/teks
   (mis. `"12.500"`, `"12500 km"` → `12500`). Tolak bila bukan bilangan bulat ≥ 0.
2. **km tidak boleh turun** — km baru `< currentKm` **ditolak** dengan pesan jelas.
   Alur reset odometer / ganti motor (km mundur secara sah) **ditunda ke Phase-2**
   (lihat §3) — di MVP km hanya boleh naik.
3. **Lonjakan tidak wajar** — selisih `> 5.000 km` dalam satu hari memunculkan
   konfirmasi inline (Ya/Tidak) sebelum disimpan (cegah typo).

---

## 8. Command & alur

| Command | Fungsi | Alur |
|---|---|---|
| `/start` | Onboarding singkat | satu pesan |
| `/daftar_motor` | Daftar motor + km awal | **bertahap** (conversations): nama → pilih jenis → km awal → seed preset |
| `/set_interval` | Ubah interval komponen | **bertahap**: pilih komponen → pilih km/waktu → ketik angka |
| `/catat_km` | Update odometer | input angka → validasi → simpan → `checkMotor()` |
| `/catat_servis` | Catat servis | **multi-pilih** komponen (inline keyboard) → km servis (default km sekarang) → reset komponen terpilih |
| `/riwayat` | Riwayat servis & km | satu pesan (dari `ServiceLog` + `KmLog`) |
| `/status` | km sekarang & sisa per komponen | satu pesan (hasil evaluasi `checkMotor` read-only) |

**Aturan UX penting:**
- `/daftar_motor` saat motor sudah ada → **ditolak**:
  "Kamu sudah punya motor terdaftar. Multi-motor belum didukung."
- `/catat_servis` → multi-pilih (PRD: "komponen" jamak). km servis default =
  `Motor.currentKm`, dengan tombol "Pakai km sekarang (X)" namun tetap bisa diketik manual.
- Sebelum command apa pun yang butuh motor, bila belum ada motor → arahkan ke `/daftar_motor`.

---

## 9. Struktur proyek

```
src/
  bot.ts            // inisialisasi grammY, polling/webhook, middleware error
  config.ts         // env: BOT_TOKEN, DATABASE_URL (tanpa hardcode rahasia)
  db.ts             // Prisma client singleton
  bot/              // handler command, conversations, inline keyboard
                    //   (dipecah per file saat mendekati 400 baris)
  domain/
    presets.ts      // preset interval per jenis motor (murni)
    reminder.ts     // perhitungan stage & pesan (murni)
    validation.ts   // aturan odometer + parseKm (murni)
  scheduler/
    cron.ts         // node-cron harian (timezone Asia/Jakarta)
    notify.ts       // rakit pesan gabungan + kirim
prisma/
  schema.prisma
tests/              // vitest
```

Aturan gaya: file < 400 baris, fungsi < 50 baris, nesting < 4 level.
`domain/` murni (tanpa I/O) agar mudah diuji dan dipindah konteks.

---

## 10. Penanganan error & keamanan

- Middleware error global grammY → tangkap exception, balas pesan ramah, log internal.
- **Tanpa rahasia ter-hardcode** — `BOT_TOKEN`, `DATABASE_URL` dari env (`.env`,
  di-`.gitignore`). Validasi keberadaan env saat start.
- Validasi seluruh input pengguna sebelum query DB (Prisma parameterized → aman dari injeksi).
- Hanya simpan data yang diperlukan (PRD §8 privasi): identitas Telegram, data motor, log km/servis.

---

## 11. Strategi testing

- **Unit dulu** pada `domain/` (target aturan 80%):
  - `reminder.ts` — tabel kasus `(komponen, currentKm, hariIni) → stage` (APPROACHING/OVERDUE,
    km-duluan vs waktu-duluan, komponen tanpa salah satu interval).
  - `validation.ts` — `parseKm` (titik ribuan, suffix "km", input invalid); penolakan km turun;
    deteksi lonjakan > 5.000.
  - `presets.ts` — `presetFor(MATIC|BEBEK|SPORT)` menghasilkan set komponen + interval benar.
- Integration test (repository/handler dengan Postgres test) ditunda ke fase berikut.

### Kriteria sukses terukur (goal-driven)
1. Daftar motor matic → DB berisi tepat komponen umum + matic dengan interval preset. → cek via test seed.
2. Catat km melewati 90% interval oli → tepat satu ping APPROACHING. → test mesin pengingat.
3. Catat km melewati 100% interval → ping OVERDUE (ping kedua). → test mesin pengingat.
4. Input `"12.500"` → tersimpan 12500. → test `parseKm`.
5. km baru < km terakhir → ditolak. → test validasi.
6. Dua komponen jatuh tempo bersamaan → satu pesan gabungan. → test `notify`.

---

## 12. Asumsi tercatat

- **Zona waktu tunggal WIB** (`Asia/Jakarta`). Indonesia punya 3 zona; per-user TZ = Phase-2.
- **State percakapan in-memory** (default grammY). Bila bot restart di tengah
  `/daftar_motor`, alur batal dan harus diulang. Dapat diterima untuk MVP.
- Odometer berupa **bilangan bulat** km, dan **hanya naik** di MVP (km mundur ditolak).
- Satu Telegram user = satu pemilik = satu motor (MVP).

---

## 13. Acuan PRD

Dokumen ini menurunkan PRD MotoTrack MVP v1.1 (13 Jun 2026). Bila terjadi konflik,
keputusan teknis di dokumen ini berlaku untuk MVP; angka interval mengikuti §6 di sini
(batas konservatif dari rentang PRD §6.4).

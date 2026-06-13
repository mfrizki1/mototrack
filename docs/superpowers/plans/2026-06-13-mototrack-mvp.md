# MotoTrack MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot (Bahasa Indonesia) that tracks one motorcycle per user, records odometer readings, and sends per-component service reminders based on km and time intervals.

**Architecture:** Single Node process = grammY bot (long-polling) + `node-cron` daily job, sharing one PostgreSQL database via Prisma. All scheduling-independent logic (interval presets, reminder stage calculation, odometer validation) lives in a pure, side-effect-free `domain/` layer that is unit-tested with vitest. Telegram handlers and the cron job are thin shells that call the domain and persist with Prisma.

**Tech Stack:** Node.js 20+, TypeScript, grammY + `@grammyjs/conversations`, Prisma + PostgreSQL, node-cron, vitest.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Project config, scripts, TS + test setup |
| `.env.example`, `.gitignore` | Env template (BOT_TOKEN, DATABASE_URL); ignore rules |
| `prisma/schema.prisma` | Data model (User, Motor, Component, ServiceLog, KmLog) |
| `src/config.ts` | Load + validate env vars (fail fast) |
| `src/db.ts` | Prisma client singleton |
| `src/data.ts` | Thin DB query helpers shared by handlers + cron |
| `src/domain/presets.ts` | Interval presets per motor type (pure) |
| `src/domain/validation.ts` | `parseKm`, odometer rules (pure) |
| `src/domain/reminder.ts` | Stage calculation, `checkMotor` (pure) |
| `src/scheduler/notify.ts` | Build reminder message (pure, unit-tested) |
| `src/scheduler/reminder-runner.ts` | Persist stages & send combined message (IO) |
| `src/scheduler/cron.ts` | Daily node-cron job (Asia/Jakarta) |
| `src/bot.ts` | grammY init, session/conversations, error middleware, command registration, start |
| `src/bot/*.ts` | One file per command/conversation |
| `tests/domain/*.test.ts` | Unit tests for the pure domain + notify message builder |

**Type contracts shared across tasks** (defined in Task 4/6, referenced later — do not redefine):
- `MotorType = 'MATIC' | 'BEBEK' | 'SPORT'`
- `NotifyStage = 'NONE' | 'APPROACHING' | 'OVERDUE'`
- `ComponentPreset { key, name, intervalKm: number|null, intervalDays: number|null }`
- `ComponentState { key, name, intervalKm, intervalDays, lastServiceKm, lastServiceDate, lastNotifiedStage }`
- `Evaluation { key, name, stage, sisaKm: number|null, sisaHari: number|null }`
- `ComponentCheck { evaluation: Evaluation, shouldNotify: boolean }`

---

## Phase A — Project scaffold

### Task 1: Initialize Node + TypeScript + vitest project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore` (already exists — add `coverage/`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mototrack",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/bot.js",
    "dev": "tsx watch src/bot.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install grammy @grammyjs/conversations @prisma/client node-cron
npm install -D typescript tsx vitest @vitest/coverage-v8 prisma @types/node @types/node-cron
```
Expected: `node_modules/` populated, no peer-dep errors.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/scheduler/notify.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
```

- [ ] **Step 5: Append to `.gitignore`**

Add this line to the existing `.gitignore`:
```
coverage/
```

- [ ] **Step 6: Verify toolchain**

Run: `npm run typecheck && npm test`
Expected: typecheck passes (no src files yet is fine), vitest reports "No test files found" (exit 0 with `--passWithNoTests` not set will exit 1 — acceptable at this step; proceed once typecheck is clean).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold Node + TypeScript + vitest project"
```

---

### Task 2: Prisma schema + client + env template

**Files:**
- Create: `prisma/schema.prisma`, `src/db.ts`, `.env.example`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id         Int      @id @default(autoincrement())
  telegramId BigInt   @unique
  name       String?
  createdAt  DateTime @default(now())
  motors     Motor[]
}

model Motor {
  id           Int          @id @default(autoincrement())
  userId       Int
  user         User         @relation(fields: [userId], references: [id])
  name         String
  type         MotorType
  initialKm    Int
  currentKm    Int
  registeredAt DateTime     @default(now())
  components   Component[]
  serviceLogs  ServiceLog[]
  kmLogs       KmLog[]
}

model Component {
  id                Int          @id @default(autoincrement())
  motorId           Int
  motor             Motor        @relation(fields: [motorId], references: [id])
  key               String
  name              String
  intervalKm        Int?
  intervalDays      Int?
  lastServiceKm     Int
  lastServiceDate   DateTime
  lastNotifiedStage NotifyStage  @default(NONE)
  serviceLogs       ServiceLog[]

  @@unique([motorId, key])
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

- [ ] **Step 2: Create `.env.example`**

```
BOT_TOKEN=your-telegram-bot-token
DATABASE_URL=postgresql://user:password@localhost:5432/mototrack?schema=public
```

- [ ] **Step 3: Validate schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 4: Generate client**

Run: `npm run prisma:generate`
Expected: "Generated Prisma Client" — `@prisma/client` types now available.

- [ ] **Step 5: Create `src/db.ts`**

```ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

- [ ] **Step 6: Run the first migration (requires a running Postgres + real DATABASE_URL)**

Copy `.env.example` to `.env`, set a real `DATABASE_URL`, then run:
```bash
npx prisma migrate dev --name init
```
Expected: migration `init` created under `prisma/migrations/`, tables created.
> If no Postgres is available yet, skip the run but still create `.env`; the migration MUST be run before Phase D handlers are exercised.

- [ ] **Step 7: Commit**

```bash
git add prisma src/db.ts .env.example
git commit -m "feat: add Prisma schema, client, and env template"
```

---

## Phase B — Pure domain (strict TDD)

### Task 3: `domain/presets.ts` — interval presets per motor type

**Files:**
- Create: `src/domain/presets.ts`
- Test: `tests/domain/presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/presets.test.ts
import { describe, it, expect } from 'vitest'
import { presetFor } from '../../src/domain/presets'

describe('presetFor', () => {
  it('includes the 6 common components for any type', () => {
    const keys = presetFor('SPORT').map(c => c.key)
    expect(keys).toEqual(
      expect.arrayContaining(['oli_mesin', 'busi', 'filter_udara', 'kampas_rem', 'minyak_rem', 'ban']),
    )
  })

  it('MATIC has matic-specific components and not manual ones', () => {
    const keys = presetFor('MATIC').map(c => c.key)
    expect(keys).toContain('v_belt')
    expect(keys).toContain('roller_cvt')
    expect(keys).toContain('oli_gardan')
    expect(keys).not.toContain('rantai_sprocket')
  })

  it('BEBEK and SPORT share manual components and exclude matic ones', () => {
    for (const t of ['BEBEK', 'SPORT'] as const) {
      const keys = presetFor(t).map(c => c.key)
      expect(keys).toContain('rantai_sprocket')
      expect(keys).toContain('oli_transmisi')
      expect(keys).not.toContain('v_belt')
    }
  })

  it('oli_mesin uses the conservative defaults 2500 km / 60 days', () => {
    const oli = presetFor('MATIC').find(c => c.key === 'oli_mesin')!
    expect(oli.intervalKm).toBe(2500)
    expect(oli.intervalDays).toBe(60)
  })

  it('kampas_rem is km-only at 5000 km', () => {
    const k = presetFor('BEBEK').find(c => c.key === 'kampas_rem')!
    expect(k.intervalKm).toBe(5000)
    expect(k.intervalDays).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/presets.test.ts`
Expected: FAIL — "Cannot find module '../../src/domain/presets'".

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/presets.ts
export type MotorType = 'MATIC' | 'BEBEK' | 'SPORT'

export interface ComponentPreset {
  key: string
  name: string
  intervalKm: number | null
  intervalDays: number | null
}

const COMMON: ComponentPreset[] = [
  { key: 'oli_mesin', name: 'Oli mesin', intervalKm: 2500, intervalDays: 60 },
  { key: 'busi', name: 'Busi', intervalKm: 6000, intervalDays: null },
  { key: 'filter_udara', name: 'Filter udara', intervalKm: 8000, intervalDays: null },
  { key: 'kampas_rem', name: 'Kampas rem', intervalKm: 5000, intervalDays: null },
  { key: 'minyak_rem', name: 'Minyak rem', intervalKm: 40000, intervalDays: 730 },
  { key: 'ban', name: 'Ban', intervalKm: 40000, intervalDays: 1095 },
]

const MATIC: ComponentPreset[] = [
  { key: 'oli_gardan', name: 'Oli gardan', intervalKm: 8000, intervalDays: 240 },
  { key: 'v_belt', name: 'V-belt', intervalKm: 20000, intervalDays: 730 },
  { key: 'roller_cvt', name: 'Roller CVT', intervalKm: 20000, intervalDays: null },
]

const MANUAL: ComponentPreset[] = [
  { key: 'rantai_sprocket', name: 'Rantai & sprocket', intervalKm: 12000, intervalDays: null },
  { key: 'oli_transmisi', name: 'Oli transmisi', intervalKm: 8000, intervalDays: 240 },
]

export function presetFor(type: MotorType): ComponentPreset[] {
  const specific = type === 'MATIC' ? MATIC : MANUAL
  return [...COMMON, ...specific]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/presets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/presets.ts tests/domain/presets.test.ts
git commit -m "feat(domain): add interval presets per motor type"
```

---

### Task 4: `domain/validation.ts` — odometer parsing & rules

**Files:**
- Create: `src/domain/validation.ts`
- Test: `tests/domain/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/validation.test.ts
import { describe, it, expect } from 'vitest'
import { parseKm, checkNewKm } from '../../src/domain/validation'

describe('parseKm', () => {
  it('strips Indonesian thousands separators', () => {
    expect(parseKm('12.500')).toBe(12500)
  })
  it('strips a "km" suffix and spaces', () => {
    expect(parseKm('12500 km')).toBe(12500)
  })
  it('accepts a plain integer', () => {
    expect(parseKm('8000')).toBe(8000)
  })
  it('returns null for non-numeric input', () => {
    expect(parseKm('abc')).toBeNull()
    expect(parseKm('')).toBeNull()
  })
})

describe('checkNewKm', () => {
  const lastLog = new Date('2026-06-10T08:00:00Z')
  const now = new Date('2026-06-13T08:00:00Z')

  it('accepts a normal increase', () => {
    expect(checkNewKm(10300, 10000, lastLog, now)).toEqual({ ok: true })
  })
  it('rejects a decrease', () => {
    expect(checkNewKm(9000, 10000, lastLog, now)).toEqual({ ok: false, reason: 'decrease' })
  })
  it('accepts equal km (no change)', () => {
    expect(checkNewKm(10000, 10000, lastLog, now)).toEqual({ ok: true })
  })
  it('flags a >5000 km jump within one day for confirmation', () => {
    const sameDay = new Date('2026-06-13T20:00:00Z')
    const lastToday = new Date('2026-06-13T08:00:00Z')
    expect(checkNewKm(16000, 10000, lastToday, sameDay)).toEqual({ ok: false, reason: 'jump', deltaKm: 6000 })
  })
  it('does NOT flag a >5000 km gain spread over more than a day', () => {
    expect(checkNewKm(16000, 10000, lastLog, now)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/validation.ts
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const JUMP_LIMIT_KM = 5000

export function parseKm(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits === '') return null
  const n = Number(digits)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export type KmCheck =
  | { ok: true }
  | { ok: false; reason: 'decrease' }
  | { ok: false; reason: 'jump'; deltaKm: number }

export function checkNewKm(
  newKm: number,
  currentKm: number,
  lastLogAt: Date,
  now: Date,
): KmCheck {
  if (newKm < currentKm) return { ok: false, reason: 'decrease' }
  const delta = newKm - currentKm
  const withinOneDay = now.getTime() - lastLogAt.getTime() <= ONE_DAY_MS
  if (withinOneDay && delta > JUMP_LIMIT_KM) {
    return { ok: false, reason: 'jump', deltaKm: delta }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/validation.ts tests/domain/validation.test.ts
git commit -m "feat(domain): add odometer parsing and validation rules"
```

---

### Task 5: `domain/reminder.ts` — stage calculation & checkMotor

**Files:**
- Create: `src/domain/reminder.ts`
- Test: `tests/domain/reminder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/reminder.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateComponent, checkMotor, daysBetween, type ComponentState } from '../../src/domain/reminder'

const base: ComponentState = {
  key: 'oli_mesin',
  name: 'Oli mesin',
  intervalKm: 2500,
  intervalDays: 60,
  lastServiceKm: 10000,
  lastServiceDate: new Date('2026-04-14T00:00:00Z'), // 60 days before "now" below
  lastNotifiedStage: 'NONE',
}
const now = new Date('2026-06-13T00:00:00Z')

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(new Date('2026-06-10T00:00:00Z'), new Date('2026-06-13T00:00:00Z'))).toBe(3)
  })
})

describe('evaluateComponent', () => {
  it('is NONE when far from both limits', () => {
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 10100, now)
    expect(ev.stage).toBe('NONE')
    expect(ev.sisaKm).toBe(2400)
  })
  it('is APPROACHING when km remaining <= 10% of interval', () => {
    // 2500 * 10% = 250 remaining -> currentKm = 10000 + 2250 = 12250
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 12250, now)
    expect(ev.stage).toBe('APPROACHING')
    expect(ev.sisaKm).toBe(250)
  })
  it('is APPROACHING when days remaining <= 7 even if km is fine', () => {
    // lastServiceDate 55 days ago, interval 60 -> 5 days left
    const ev = evaluateComponent(
      { ...base, lastServiceDate: new Date('2026-04-19T00:00:00Z') },
      10100,
      now,
    )
    expect(ev.stage).toBe('APPROACHING')
  })
  it('is OVERDUE when km consumed >= interval (takes precedence over approaching)', () => {
    const ev = evaluateComponent({ ...base, lastServiceDate: now }, 12500, now)
    expect(ev.stage).toBe('OVERDUE')
    expect(ev.sisaKm).toBe(0)
  })
  it('is OVERDUE when days consumed >= interval', () => {
    const ev = evaluateComponent(base, 10100, now) // 60 days elapsed, interval 60
    expect(ev.stage).toBe('OVERDUE')
  })
  it('ignores km when intervalKm is null', () => {
    const ev = evaluateComponent(
      { ...base, intervalKm: null, lastServiceDate: now },
      999999,
      now,
    )
    expect(ev.stage).toBe('NONE')
    expect(ev.sisaKm).toBeNull()
  })
})

describe('checkMotor', () => {
  it('notifies only when stage rank increases past lastNotifiedStage', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'NONE' }, // -> APPROACHING at 12250 -> notify
      { ...base, key: 'busi', name: 'Busi', intervalKm: 6000, intervalDays: null,
        lastServiceDate: now, lastNotifiedStage: 'APPROACHING' }, // still far -> NONE, no notify
    ]
    const checks = checkMotor(components, 12250, now)
    expect(checks.find(c => c.evaluation.key === 'oli_mesin')!.shouldNotify).toBe(true)
    expect(checks.find(c => c.evaluation.key === 'busi')!.shouldNotify).toBe(false)
  })

  it('does not re-notify a component already at the same stage', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'APPROACHING' },
    ]
    const checks = checkMotor(components, 12250, now) // computes APPROACHING
    expect(checks[0].shouldNotify).toBe(false)
  })

  it('fires the second ping on APPROACHING -> OVERDUE', () => {
    const components: ComponentState[] = [
      { ...base, lastServiceDate: now, lastNotifiedStage: 'APPROACHING' },
    ]
    const checks = checkMotor(components, 12500, now) // OVERDUE
    expect(checks[0].shouldNotify).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/reminder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/reminder.ts
export type NotifyStage = 'NONE' | 'APPROACHING' | 'OVERDUE'

export interface ComponentState {
  key: string
  name: string
  intervalKm: number | null
  intervalDays: number | null
  lastServiceKm: number
  lastServiceDate: Date
  lastNotifiedStage: NotifyStage
}

export interface Evaluation {
  key: string
  name: string
  stage: NotifyStage
  sisaKm: number | null
  sisaHari: number | null
}

export interface ComponentCheck {
  evaluation: Evaluation
  shouldNotify: boolean
}

const KM_LEAD = 0.1
const DAYS_LEAD = 7
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const RANK: Record<NotifyStage, number> = { NONE: 0, APPROACHING: 1, OVERDUE: 2 }

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / ONE_DAY_MS)
}

export function evaluateComponent(c: ComponentState, currentKm: number, now: Date): Evaluation {
  const sisaKm = c.intervalKm == null ? null : c.intervalKm - (currentKm - c.lastServiceKm)
  const sisaHari = c.intervalDays == null ? null : c.intervalDays - daysBetween(c.lastServiceDate, now)

  const overdue =
    (c.intervalKm != null && sisaKm! <= 0) ||
    (c.intervalDays != null && sisaHari! <= 0)
  const approaching =
    (c.intervalKm != null && sisaKm! <= c.intervalKm * KM_LEAD) ||
    (c.intervalDays != null && sisaHari! <= DAYS_LEAD)

  const stage: NotifyStage = overdue ? 'OVERDUE' : approaching ? 'APPROACHING' : 'NONE'
  return { key: c.key, name: c.name, stage, sisaKm, sisaHari }
}

export function checkMotor(components: ComponentState[], currentKm: number, now: Date): ComponentCheck[] {
  return components.map((c) => {
    const evaluation = evaluateComponent(c, currentKm, now)
    return { evaluation, shouldNotify: RANK[evaluation.stage] > RANK[c.lastNotifiedStage] }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/reminder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/reminder.ts tests/domain/reminder.test.ts
git commit -m "feat(domain): add reminder stage calculation and checkMotor"
```

---

### Task 6: `scheduler/notify.ts` — reminder message builder (pure part, TDD)

**Files:**
- Create: `src/scheduler/notify.ts`
- Test: `tests/domain/notify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/notify.test.ts
import { describe, it, expect } from 'vitest'
import { buildReminderMessage } from '../../src/scheduler/notify'
import type { Evaluation } from '../../src/domain/reminder'

const approaching: Evaluation = { key: 'oli_mesin', name: 'Oli mesin', stage: 'APPROACHING', sisaKm: 250, sisaHari: 40 }
const overdue: Evaluation = { key: 'ban', name: 'Ban', stage: 'OVERDUE', sisaKm: -100, sisaHari: null }

describe('buildReminderMessage', () => {
  it('lists each due component with its name', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg).toContain('Vario 125')
    expect(msg).toContain('Oli mesin')
    expect(msg).toContain('Ban')
  })
  it('marks overdue components distinctly from approaching ones', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg).toContain('Mendekati')
    expect(msg).toContain('LEWAT JADWAL')
  })
  it('combines multiple components into a single message that points to /catat_servis', () => {
    const msg = buildReminderMessage('Vario 125', [approaching, overdue])
    expect(msg.match(/\/catat_servis/g)!.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure message builder**

```ts
// src/scheduler/notify.ts
import type { Evaluation } from '../domain/reminder'

export function buildReminderMessage(motorName: string, due: Evaluation[]): string {
  const lines = due.map((d) => {
    const label = d.stage === 'OVERDUE' ? '⚠️ LEWAT JADWAL' : '🔔 Mendekati'
    const parts: string[] = []
    if (d.sisaKm != null) parts.push(d.sisaKm <= 0 ? `lewat ${-d.sisaKm} km` : `sisa ${d.sisaKm} km`)
    if (d.sisaHari != null) parts.push(d.sisaHari <= 0 ? `lewat ${-d.sisaHari} hari` : `sisa ${d.sisaHari} hari`)
    return `${label} — ${d.name} (${parts.join(', ')})`
  })
  return (
    `Pengingat servis untuk *${motorName}*:\n` +
    lines.join('\n') +
    `\n\nSudah servis? Catat dengan /catat_servis`
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full domain suite + coverage gate**

Run: `npm run coverage`
Expected: all tests pass, coverage for `src/domain/**` and `src/scheduler/notify.ts` ≥ 80%.

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/notify.ts tests/domain/notify.test.ts
git commit -m "feat(scheduler): add pure reminder message builder"
```

---

## Phase C — Config, data access, and reminder orchestration

### Task 7: `config.ts` — env loading & validation

**Files:**
- Create: `src/config.ts`
- Test: `tests/domain/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  it('returns config when both vars are present', () => {
    expect(loadConfig({ BOT_TOKEN: 'abc', DATABASE_URL: 'postgres://x' })).toEqual({
      botToken: 'abc',
      databaseUrl: 'postgres://x',
    })
  })
  it('throws a clear error when BOT_TOKEN is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/BOT_TOKEN/)
  })
  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ BOT_TOKEN: 'abc' })).toThrow(/DATABASE_URL/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/config.ts
export interface Config {
  botToken: string
  databaseUrl: string
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Config {
  const botToken = env.BOT_TOKEN
  const databaseUrl = env.DATABASE_URL
  if (!botToken) throw new Error('Missing required env var BOT_TOKEN')
  if (!databaseUrl) throw new Error('Missing required env var DATABASE_URL')
  return { botToken, databaseUrl }
}
```

> Add `src/config.ts` to the vitest coverage `include` list in `vitest.config.ts` if you want it counted; optional.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/domain/config.test.ts
git commit -m "feat: add env config loader with validation"
```

---

### Task 8: `data.ts` — shared DB query helpers

**Files:**
- Create: `src/data.ts`

> No unit test (thin Prisma wrappers; covered indirectly by manual smoke tests in Phase D). Each function has one query responsibility.

- [ ] **Step 1: Write the helpers**

```ts
// src/data.ts
import { prisma } from './db'
import { presetFor, type MotorType } from './domain/presets'
import type { ComponentState } from './domain/reminder'

export async function ensureUser(telegramId: bigint, name?: string) {
  return prisma.user.upsert({
    where: { telegramId },
    update: {},
    create: { telegramId, name },
  })
}

export async function getMotorByTelegramId(telegramId: bigint) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    include: { motors: { include: { components: true }, take: 1 } },
  })
  return user?.motors[0] ?? null
}

export async function createMotorWithPresets(
  userId: number,
  name: string,
  type: MotorType,
  initialKm: number,
  now: Date,
) {
  return prisma.motor.create({
    data: {
      userId,
      name,
      type,
      initialKm,
      currentKm: initialKm,
      registeredAt: now,
      components: {
        create: presetFor(type).map((p) => ({
          key: p.key,
          name: p.name,
          intervalKm: p.intervalKm,
          intervalDays: p.intervalDays,
          lastServiceKm: initialKm,
          lastServiceDate: now,
        })),
      },
    },
    include: { components: true },
  })
}

export async function addKmLog(motorId: number, km: number) {
  await prisma.kmLog.create({ data: { motorId, km } })
  await prisma.motor.update({ where: { id: motorId }, data: { currentKm: km } })
}

export async function resetComponents(motorId: number, componentIds: number[], km: number, date: Date) {
  for (const componentId of componentIds) {
    await prisma.component.update({
      where: { id: componentId },
      data: { lastServiceKm: km, lastServiceDate: date, lastNotifiedStage: 'NONE' },
    })
    await prisma.serviceLog.create({ data: { motorId, componentId, km, date } })
  }
}

export async function setComponentInterval(componentId: number, intervalKm: number | null, intervalDays: number | null) {
  await prisma.component.update({ where: { id: componentId }, data: { intervalKm, intervalDays } })
}

// Map a Prisma component row to the pure ComponentState used by the domain.
export function toComponentState(c: {
  key: string; name: string; intervalKm: number | null; intervalDays: number | null
  lastServiceKm: number; lastServiceDate: Date; lastNotifiedStage: string
}): ComponentState {
  return {
    key: c.key,
    name: c.name,
    intervalKm: c.intervalKm,
    intervalDays: c.intervalDays,
    lastServiceKm: c.lastServiceKm,
    lastServiceDate: c.lastServiceDate,
    lastNotifiedStage: c.lastNotifiedStage as ComponentState['lastNotifiedStage'],
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (Prisma client generated in Task 2).

- [ ] **Step 3: Commit**

```bash
git add src/data.ts
git commit -m "feat: add shared Prisma query helpers"
```

---

### Task 9: `runReminderCheck` — persist stages & send combined message (IO half of notify)

**Files:**
- Create: `src/scheduler/reminder-runner.ts`

> Keep `buildReminderMessage` pure inside `notify.ts` (it stays in the coverage gate).
> The IO orchestration lives in its own file, which is NOT in the coverage `include` list —
> so its untested Telegram/Prisma calls do not drag the 80% threshold down.

- [ ] **Step 1: Create the orchestration module**

```ts
// src/scheduler/reminder-runner.ts
import type { Api } from 'grammy'
import { prisma } from '../db'
import { checkMotor } from '../domain/reminder'
import { toComponentState } from '../data'
import { buildReminderMessage } from './notify'

interface MotorForCheck {
  id: number
  name: string
  currentKm: number
  user: { telegramId: bigint }
  components: {
    id: number; key: string; name: string; intervalKm: number | null; intervalDays: number | null
    lastServiceKm: number; lastServiceDate: Date; lastNotifiedStage: string
  }[]
}

export async function runReminderCheck(api: Api, motor: MotorForCheck, now: Date = new Date()): Promise<void> {
  const states = motor.components.map(toComponentState)
  const checks = checkMotor(states, motor.currentKm, now)

  // Persist the freshly computed stage for every component (keeps stage in sync up AND down).
  await Promise.all(
    checks.map((ch, i) =>
      prisma.component.update({
        where: { id: motor.components[i].id },
        data: { lastNotifiedStage: ch.evaluation.stage },
      }),
    ),
  )

  const due = checks.filter((c) => c.shouldNotify).map((c) => c.evaluation)
  if (due.length > 0) {
    await api.sendMessage(Number(motor.user.telegramId), buildReminderMessage(motor.name, due), {
      parse_mode: 'Markdown',
    })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scheduler/reminder-runner.ts
git commit -m "feat(scheduler): persist stages and send combined reminder"
```

---

## Phase D — Telegram bot wiring

> grammY conversations API can differ slightly by version. These tasks target
> `grammy@^1.30` + `@grammyjs/conversations@^1.2`. If the installed version differs,
> adapt the `conversations()` / `createConversation()` wiring to match its README —
> the handler logic stays the same.

### Task 10: `bot.ts` — grammY init, session, conversations, error middleware

**Files:**
- Create: `src/bot.ts`
- Create: `src/context.ts` (shared context type)

- [ ] **Step 1: Create the shared context type**

```ts
// src/context.ts
import type { Context, SessionFlavor } from 'grammy'
import type { ConversationFlavor } from '@grammyjs/conversations'

export interface SessionData {}
export type MyContext = Context & SessionFlavor<SessionData> & ConversationFlavor
```

- [ ] **Step 2: Create `bot.ts`**

```ts
// src/bot.ts
import { Bot, session } from 'grammy'
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

bot.use(session({ initial: (): {} => ({}) }))
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
```

> `bot/*` modules and the two conversation functions are created in the following tasks.
> Until they exist, `bot.ts` will not typecheck — that is expected; it goes green at Task 16.

- [ ] **Step 3: Commit (scaffold; compiles after Phase D completes)**

```bash
git add src/bot.ts src/context.ts
git commit -m "feat(bot): add grammY init, session, conversations, error handler"
```

---

### Task 11: `/start` command + user upsert

**Files:**
- Create: `src/bot/start.ts`

- [ ] **Step 1: Write the handler**

```ts
// src/bot/start.ts
import type { Bot } from 'grammy'
import type { MyContext } from '../context'
import { ensureUser } from '../data'

const WELCOME = [
  'Selamat datang di *MotoTrack* 🏍️',
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
  '/riwayat — riwayat km & servis',
].join('\n')

export function registerStart(bot: Bot<MyContext>): void {
  bot.command('start', async (ctx) => {
    if (ctx.from) await ensureUser(BigInt(ctx.from.id), ctx.from.first_name)
    await ctx.reply(WELCOME, { parse_mode: 'Markdown' })
  })
}
```

- [ ] **Step 2: Typecheck just this file's deps**

Run: `npm run typecheck`
Expected: errors only from `bot.ts` referencing not-yet-created modules; `start.ts` itself clean.

- [ ] **Step 3: Commit**

```bash
git add src/bot/start.ts
git commit -m "feat(bot): add /start command with user upsert"
```

---

### Task 12: `/daftar_motor` conversation

**Files:**
- Create: `src/bot/daftarMotor.ts`

- [ ] **Step 1: Write the conversation + command**

```ts
// src/bot/daftarMotor.ts
import { InlineKeyboard, type Bot } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { MyContext } from '../context'
import type { MotorType } from '../domain/presets'
import { parseKm } from '../domain/validation'
import { ensureUser, getMotorByTelegramId, createMotorWithPresets } from '../data'

export async function daftarMotor(conversation: Conversation<MyContext>, ctx: MyContext): Promise<void> {
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
    `Motor *${name}* (${type}) terdaftar dengan ${km} km. ` +
      `Interval komponen sudah aktif otomatis.\n\nCek dengan /status.`,
    { parse_mode: 'Markdown' },
  )
}

export function registerDaftarMotor(bot: Bot<MyContext>): void {
  bot.command('daftar_motor', async (ctx) => {
    await ctx.conversation.enter('daftarMotor')
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: `daftarMotor.ts` clean (remaining errors only from other not-yet-created `bot/*`).

- [ ] **Step 3: Commit**

```bash
git add src/bot/daftarMotor.ts
git commit -m "feat(bot): add /daftar_motor conversation with preset seeding"
```

---

### Task 13: `/catat_km` command + reminder trigger

**Files:**
- Create: `src/bot/catatKm.ts`

- [ ] **Step 1: Write the handler**

```ts
// src/bot/catatKm.ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: `catatKm.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add src/bot/catatKm.ts
git commit -m "feat(bot): add /catat_km with validation and reminder trigger"
```

---

### Task 14: `/status` command

**Files:**
- Create: `src/bot/status.ts`

- [ ] **Step 1: Write the handler**

```ts
// src/bot/status.ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: `status.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add src/bot/status.ts
git commit -m "feat(bot): add /status command"
```

---

### Task 15: `/catat_servis` command (multi-select reset) + `/riwayat`

**Files:**
- Create: `src/bot/catatServis.ts`
- Create: `src/bot/riwayat.ts`

- [ ] **Step 1: Write `/catat_servis`**

```ts
// src/bot/catatServis.ts
import { InlineKeyboard, type Bot } from 'grammy'
import type { MyContext } from '../context'
import { prisma } from '../db'
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

  // Toggle selection by editing the keyboard caption with a checkmark prefix.
  bot.callbackQuery(/^srv:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Dipilih ✓')
    const id = ctx.match[1]
    const kb = ctx.callbackQuery.message?.reply_markup
    if (!kb) return
    // Rebuild keyboard marking the chosen row.
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
```

> Note: this reads the selected state back from the message's own keyboard (a ✓ prefix),
> so no session state is needed. `prisma` import kept for parity with other handlers if you
> extend it; remove if your linter flags it as unused.

- [ ] **Step 2: Write `/riwayat`**

```ts
// src/bot/riwayat.ts
import type { Bot } from 'grammy'
import type { MyContext } from '../context'
import { prisma } from '../db'
import { getMotorByTelegramId } from '../data'

export function registerRiwayat(bot: Bot<MyContext>): void {
  bot.command('riwayat', async (ctx) => {
    const motor = await getMotorByTelegramId(BigInt(ctx.from!.id))
    if (!motor) return ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')

    const [services, kms] = await Promise.all([
      prisma.serviceLog.findMany({
        where: { motorId: motor.id },
        orderBy: { date: 'desc' },
        take: 10,
        include: { component: true },
      }),
      prisma.kmLog.findMany({ where: { motorId: motor.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ])

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const svcLines = services.length
      ? services.map((s) => `• ${fmt(s.date)} — ${s.component.name} @ ${s.km} km`).join('\n')
      : 'Belum ada riwayat servis.'
    const kmLines = kms.length
      ? kms.map((k) => `• ${fmt(k.createdAt)} — ${k.km} km`).join('\n')
      : 'Belum ada catatan km.'

    await ctx.reply(`*Riwayat servis:*\n${svcLines}\n\n*Catatan km terakhir:*\n${kmLines}`, {
      parse_mode: 'Markdown',
    })
  })
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: both files clean.

- [ ] **Step 4: Commit**

```bash
git add src/bot/catatServis.ts src/bot/riwayat.ts
git commit -m "feat(bot): add /catat_servis multi-select reset and /riwayat"
```

---

### Task 16: `/set_interval` conversation

**Files:**
- Create: `src/bot/setInterval.ts`

- [ ] **Step 1: Write the conversation + command**

```ts
// src/bot/setInterval.ts
import { InlineKeyboard, type Bot } from 'grammy'
import type { Conversation } from '@grammyjs/conversations'
import type { MyContext } from '../context'
import { parseKm } from '../domain/validation'
import { getMotorByTelegramId, setComponentInterval } from '../data'

export async function setInterval(conversation: Conversation<MyContext>, ctx: MyContext): Promise<void> {
  const motor = await conversation.external(() => getMotorByTelegramId(BigInt(ctx.from!.id)))
  if (!motor) {
    await ctx.reply('Belum ada motor. Daftar dulu dengan /daftar_motor.')
    return
  }

  const kb = new InlineKeyboard()
  for (const c of motor.components) kb.text(c.name, `si:${c.id}`).row()
  await ctx.reply('Pilih komponen yang mau diatur intervalnya:', { reply_markup: kb })

  const pick = await conversation.waitForCallbackQuery(/^si:(\d+)$/)
  await pick.answerCallbackQuery()
  const componentId = Number(pick.match![1])
  const component = motor.components.find((c) => c.id === componentId)!

  const fieldKb = new InlineKeyboard().text('Interval km', 'field:km').text('Interval waktu (hari)', 'field:days')
  await ctx.reply(`Atur apa untuk *${component.name}*?`, { reply_markup: fieldKb, parse_mode: 'Markdown' })
  const fieldCtx = await conversation.waitForCallbackQuery(['field:km', 'field:days'])
  await fieldCtx.answerCallbackQuery()
  const field = fieldCtx.callbackQuery.data === 'field:km' ? 'km' : 'days'

  await ctx.reply(`Masukkan angka ${field === 'km' ? 'km' : 'hari'} (atau 0 untuk menonaktifkan):`)
  let value: number | null = null
  while (value === null) {
    const msg = await conversation.waitFor('message:text')
    value = parseKm(msg.message.text)
    if (value === null) await ctx.reply('Format tidak valid. Masukkan angka.')
  }
  const finalValue = value === 0 ? null : value

  await conversation.external(() =>
    setComponentInterval(
      componentId,
      field === 'km' ? finalValue : component.intervalKm,
      field === 'days' ? finalValue : component.intervalDays,
    ),
  )
  await ctx.reply(
    `Interval *${component.name}* diperbarui: ${field === 'km' ? 'km' : 'hari'} = ${finalValue ?? 'nonaktif'}.`,
    { parse_mode: 'Markdown' },
  )
}

export function registerSetInterval(bot: Bot<MyContext>): void {
  bot.command('set_interval', async (ctx) => {
    await ctx.conversation.enter('setInterval')
  })
}
```

- [ ] **Step 2: Full typecheck — `bot.ts` should now compile**

Run: `npm run typecheck`
Expected: PASS across the whole project (all `bot/*` modules now exist).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `dist/` produced, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/bot/setInterval.ts
git commit -m "feat(bot): add /set_interval conversation"
```

---

## Phase E — Scheduler & end-to-end verification

### Task 17: `scheduler/cron.ts` — daily reminder job

**Files:**
- Create: `src/scheduler/cron.ts`
- Modify: `src/bot.ts` (start the cron alongside the bot)

- [ ] **Step 1: Write the cron module**

```ts
// src/scheduler/cron.ts
import cron from 'node-cron'
import type { Api } from 'grammy'
import { prisma } from '../db'
import { runReminderCheck } from './reminder-runner'

// Runs every day at 09:00 Asia/Jakarta.
export function startDailyReminders(api: Api): void {
  cron.schedule(
    '0 9 * * *',
    async () => {
      const motors = await prisma.motor.findMany({ include: { user: true, components: true } })
      for (const motor of motors) {
        try {
          await runReminderCheck(api, motor, new Date())
        } catch (err) {
          console.error(`Reminder check failed for motor ${motor.id}:`, err)
        }
      }
    },
    { timezone: 'Asia/Jakarta' },
  )
}
```

- [ ] **Step 2: Wire it into `bot.ts`**

In `src/bot.ts`, add the import near the top:
```ts
import { startDailyReminders } from './scheduler/cron'
```
Replace the startup block at the bottom with:
```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  startDailyReminders(bot.api)
  bot.start()
  console.log('MotoTrack bot started (polling) with daily reminders.')
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/scheduler/cron.ts src/bot.ts
git commit -m "feat(scheduler): add daily reminder cron (Asia/Jakarta)"
```

---

### Task 18: End-to-end smoke test against Telegram

**Files:** none (manual verification)

**Prerequisites:** a real `BOT_TOKEN` from @BotFather, a running Postgres, `.env` filled,
and `npx prisma migrate dev` already applied (Task 2 Step 6).

- [ ] **Step 1: Run the full test suite + coverage**

Run: `npm run coverage`
Expected: all unit tests pass; `src/domain/**` + `notify.ts` ≥ 80% coverage.

- [ ] **Step 2: Start the bot**

Run: `npm run dev`
Expected: console prints "MotoTrack bot started (polling) with daily reminders."

- [ ] **Step 3: Exercise the happy path in Telegram**

In a Telegram chat with the bot, verify each:
- `/start` → welcome message.
- `/daftar_motor` → answer name, pick a type, enter km → confirmation; second `/daftar_motor` → "sudah punya motor terdaftar".
- `/status` → lists all seeded components with remaining km/days.
- `/catat_km 999999` → triggers the >5000 jump confirmation; choose "Batal".
- `/catat_km <currentKm - 1>` → rejected as decrease.
- `/catat_km <value past a 90% threshold>` → reminder message for the due component(s).
- `/catat_servis` → select a component, Selesai → "Servis dicatat… Hitungan direset"; `/status` shows it reset.
- `/set_interval` → pick a component, set km, confirm; `/status` reflects the new interval.
- `/riwayat` → shows the service + km entries.

- [ ] **Step 4: Tag the MVP**

```bash
git tag mvp-v0.1.0
```

---

## Self-Review (completed during planning)

**Spec coverage** — every spec section maps to a task:
- §2 stack/arch → Tasks 1–2, 10, 17
- §4 data model → Task 2
- §5 reminder engine (stage precedence, two-ping, combined message) → Tasks 5, 6, 9
- §6 presets (conservative) → Task 3
- §7 validation (parseKm, km-only-up, jump confirm) → Tasks 4, 13
- §8 commands → Tasks 11–16
- §9 structure → enforced by file map + per-task paths
- §10 error/secrets (env, grammY catch) → Tasks 7, 10
- §11 testing (unit-first domain, success criteria) → Tasks 3–6, 18
- §12 assumptions (WIB cron, in-memory conversation) → Tasks 17, 10

**Placeholder scan** — no TBD/TODO; every code step shows complete code; manual-only steps (migrations, Telegram smoke test) are explicitly IO/integration and labeled as such, consistent with the spec's "unit-first, integration deferred" decision.

**Type consistency** — `MotorType`, `NotifyStage`, `ComponentPreset`, `ComponentState`, `Evaluation`, `ComponentCheck` are defined once (Tasks 3/5) and only imported afterward. `presetFor`, `parseKm`, `checkNewKm`, `evaluateComponent`, `checkMotor`, `buildReminderMessage`, `runReminderCheck`, and the `data.ts` helpers keep identical signatures across all call sites.

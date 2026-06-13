import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Missing DATABASE_URL environment variable')
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)

export const prisma = new PrismaClient({ adapter })

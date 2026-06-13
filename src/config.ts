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

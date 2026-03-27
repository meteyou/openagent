import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const rootDir = process.cwd()

for (const file of ['.env', '.env.local']) {
  const filePath = path.join(rootDir, file)
  if (fs.existsSync(filePath)) {
    process.loadEnvFile(filePath)
  }
}

const resolvedDataDir = path.resolve(rootDir, process.env.DATA_DIR || '.data')
process.env.DATA_DIR = resolvedDataDir
process.env.PORT ||= '3000'
process.env.HOST ||= '0.0.0.0'
process.env.NUXT_PUBLIC_API_BASE ||= 'http://localhost:3001'
process.env.ADMIN_USERNAME ||= 'admin'
process.env.ADMIN_PASSWORD ||= 'admin'
process.env.JWT_SECRET ||= 'openagent-dev-secret-change-me'

fs.mkdirSync(resolvedDataDir, { recursive: true })

console.log('[openagent] Starting local dev environment...')
console.log(`[openagent] DATA_DIR=${process.env.DATA_DIR}`)
console.log(`[openagent] Backend:  http://localhost:${process.env.PORT}`)
console.log('[openagent] Frontend: http://localhost:3001')

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npmCmd, ['run', 'dev:backend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  }),
  spawn(npmCmd, ['run', 'dev:frontend'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  }),
]

let shuttingDown = false
let exitCode = 0

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }, 3000).unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal))
}

let exitedChildren = 0
for (const child of children) {
  child.on('exit', (code, signal) => {
    exitedChildren += 1

    if (signal || (code && code !== 0)) {
      exitCode = code ?? 1
    }

    if (!shuttingDown && exitedChildren < children.length) {
      shutdown('SIGTERM')
    }

    if (exitedChildren === children.length) {
      process.exit(exitCode)
    }
  })
}

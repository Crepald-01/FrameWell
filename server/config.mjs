import { join } from 'node:path'
import { homedir } from 'node:os'

export const editorOrigin = 'http://127.0.0.1:4785'
export const sandboxOrigin = 'http://127.0.0.1:4786'
export const dataDir = process.env.FRAMEWELL_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), 'Framewell')
export const runtimeFile = join(dataDir, 'connection.json')
export const inboxDir = join(dataDir, 'inbox')
export const mediaDir = join(dataDir, 'media')
export const outputDir = join(dataDir, 'exports')
export const stagingDir = join(dataDir, 'uploads')

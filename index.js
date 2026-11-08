/**
 * dsh-wallpaper / host half
 *
 * The wallpaper itself lives in the browser half, because the canvas is the
 * page and only the page can draw behind it. What the host owns is the one
 * thing a browser cannot be trusted with: a durable document that survives a
 * cache wipe and travels with a profile copy.
 *
 *   GET  /api/dsh-wallpaper/config   the saved wallpaper document
 *   POST /api/dsh-wallpaper/config   replace it
 *   GET  /api/dsh-wallpaper/health   mount check
 *
 * The document is a JSON object with an image data URL, so it is kept on disk
 * under `$DSH_HOME/dsh-wallpaper.json` rather than in browser localStorage,
 * which has a small quota and would reject a typical wallpaper. The browser
 * keeps a localStorage mirror of the small fields (enabled, opacity) for a
 * fast first paint, and hydrates the image from this half when needed.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Stable cordis plugin name. */
export const name = 'wallpaper'

/** Services the routes need before they can mount. */
export const inject = ['webServer']

const API = '/api/dsh-wallpaper'

const ROUTES = {
  config: `${API}/config`,
  health: `${API}/health`,
}

/** Largest document accepted on the write route (a data-URL wallpaper). */
const BODY_LIMIT = 24 * 1024 * 1024

/** Where the document lives. */
function configPath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-wallpaper.json')
}

/** Headers every answer carries. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/**
 * Turn a thrown value into text a client can read.
 * @param {unknown} error - whatever was thrown.
 * @returns {string} a message.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} response - the server response.
 * @param {number} status - the status code.
 * @param {unknown} payload - the body.
 */
function sendJson(response, status, payload) {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(payload))
}

/**
 * Whether the caller is on this machine. The wallpaper is user preference, not
 * secret, but a remote browser tab has no business rewriting it: loopback is
 * the whole fence, and an unidentifiable peer is refused rather than trusted.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {boolean} whether the call may proceed.
 */
function isLocal(request) {
  const address = request.socket?.remoteAddress ?? ''
  if (address === '') return false
  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.')
  )
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {Promise<unknown>} the parsed body, or undefined when unusable.
 */
async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read the saved document.
 * @returns {Promise<Record<string, unknown>>} the parsed document, or {} when absent.
 */
async function readDocument() {
  try {
    const text = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Replace the saved document atomically: a partly written file would leave the
 * wallpaper half-restored on the next launch.
 * @param {Record<string, unknown>} document - the new document.
 */
async function writeDocument(document) {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/**
 * Mount the routes.
 * @param {import('cordis').Context} ctx - the host plugin context.
 */
function applyImpl(ctx) {
  const handleConfig = async (request, response) => {
    if (!isLocal(request)) {
      sendJson(response, 403, { error: 'local-only' })
      return
    }
    if (request.method === 'GET') {
      try {
        sendJson(response, 200, { document: await readDocument() })
      } catch (error) {
        sendJson(response, 500, { error: describe(error) })
      }
      return
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: `method not allowed: ${request.method}` })
      return
    }
    const body = await readBody(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'unreadable body' })
      return
    }
    const document = body?.document
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      sendJson(response, 400, { error: 'document must be an object' })
      return
    }
    try {
      await writeDocument(document)
      sendJson(response, 200, { ok: true })
    } catch (error) {
      sendJson(response, 500, { error: describe(error) })
    }
  }

  const handlers = [
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: (request, response) => {
        if (!isLocal(request)) {
          sendJson(response, 403, { error: 'local-only' })
          return
        }
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: `method not allowed: ${request.method}` })
          return
        }
        sendJson(response, 200, { ok: true, path: configPath() })
      },
    },
    {
      kind: 'exact',
      path: ROUTES.config,
      handler: handleConfig,
    },
  ]

  ctx.effect(() => {
    const disposers = handlers.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'wallpaper: routes')
}

/** Guard so a second mount in one process is a no-op. */
const MOUNTED = Symbol.for('dsh.web.mounted-dsh-wallpaper')

/**
 * Mount the routes once per process.
 * @param {import('cordis').Context} ctx - the host plugin context.
 */
export function apply(ctx) {
  const registry = globalThis
  if (registry[MOUNTED] === true) return
  registry[MOUNTED] = true
  ctx.effect(
    () => () => {
      registry[MOUNTED] = false
    },
    'wallpaper: mount guard',
  )
  applyImpl(ctx)
}

export { ROUTES }

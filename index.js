const LRUCache = require('lru-cache')
const httpProxy = require('http-proxy')
const { send, text, json, sendError } = require('micro')
const winston = require('winston')

const cache = new LRUCache({ max: 500 })
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.simple(),
  ),
  transports: [
    new winston.transports.Console(),
  ],
})

let proxy

function createProxyFn(config) {
  proxy = createContentfulProxy(config)

  return (req, res) => {
    if (req.method === 'DELETE') {
      clearCache()
      send(res, 200)
      return
    }

    if (!/entries/.test(req.url)) {
      logger.info(`Not valid contentful request url (${req.url}), return 404.`)
      send(res, 404, 'Not Found.')
      return
    }

    if (cache.has(req.url) && !cache.get(req.url).old) {
      logger.info(`Cache HIT for ${req.url}`)
      const cached = cache.get(req.url)
      addHeaders(res, {
        ...cached.headers,
        'X-contentful-cache': 'HIT',
      })
      send(res, 200, cached.data)
      return
    }

    logger.info(`Cache MISS for ${req.url}`)
    res.currentRetry = 3
    res.req = req
    // Hack (Sen): Remove If-None-Match if exists in client request.
    Object.keys(req.headers).forEach(header => {
      if (header.toLowerCase() === 'if-none-match') {
        delete req.headers[header]
      }
    })
    proxy.web(req, res)
  }
}

function addHeaders(res, headers) {
  Object.keys(headers).forEach(header => {
    res.setHeader(header, headers[header])
  })
}

function clearCache() {
  logger.info(`Clear ${cache.itemCount} caches (flag as old).`)
  cache.forEach(v => v.old = true)
}

function createContentfulProxy(config) {
  const target = getContentfulUrl()
  const token = config.accessToken

  const options = {
    target,
    changeOrigin: true,
    xfwd: true,
    secure: true,
    preserveHeaderKeyCase: true,
    selfHandleResponse: true,
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Encoding': '',
      'Access-Control-Allow-Headers': '*',
    }
  }

  return httpProxy.createProxyServer(options)
    .on('proxyRes', cacheResponse)
    .on('error', handleError)
}

async function cacheResponse(proxyRes, { url: key }, res) {
  const { status, statusText, headers } = proxyRes
  try {
    const data = await json(proxyRes)
    logger.info(`Write cache for ${key} .`)
    const newHeaders = {
      ...headers,
      'X-contentful-cache-time': new Date().toISOString(),
    }
    cache.set(key, {
      status,
      statusText,
      headers: newHeaders,
      data,
    })
    addHeaders(res, {
      ...newHeaders,
      'X-contentful-cache': 'MISS',
    })
    send(res, 200, data)

  } catch (e) {
    console.error(e)
    logger.error(`Error: Failed to fetch ${key}, statusCode: ${proxyRes.statusCode}.`)

    if (res.currentRetry && res.currentRetry > 0) {
      res.currentRetry--
      logger.error(`Retry: ${res.currentRetry}`)
      proxy.web(res.req, res)
    } else {
      if (cache.has(key)) {
        logger.warn(`All retries failed, using old cache for ${key}.`)
        const cached = cache.get(key)
        addHeaders(res, {
          ...cached.headers,
          'X-contentful-cache': 'stale',
        })
        send(res, 200, cached.data)
      } else {
        logger.error(`All retries failed, no cache exists for ${key}, return 400.`)
        send(res, 400)
      }
    }
  }
}

function getContentfulUrl() {
  return `http://cdn.contentful.com`
}

function handleError(err, req, res) {
  sendError(req, res, err)
}

const config = {
  accessToken: process.env['CONTENTFUL_ACCESS_TOKEN'],
}
if (config.accessToken) {
  logger.info("Read access token from env.")
}
module.exports = createProxyFn(config)

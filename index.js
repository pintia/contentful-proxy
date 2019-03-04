const LRUCache = require('lru-cache')
const httpProxy = require('http-proxy')
const { send, json, sendError } = require('micro')
const winston = require('winston')

const cache = new LRUCache({ maxAge: 1000 * 60 * 60 * 24 }) // cache for 1 day
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.logstash(),
  ),
  defaultMeta: { app: 'contentful-proxy' },
  transports: [
    new winston.transports.Console(),
  ],
})

function createProxyFn(config) {
  const proxy = createContentfulProxy(config)

  return (req, res) => {
    if (req.method === 'DELETE') {
      clearCache()
      send(res, 200)
      return
    }

    if (cache.has(req.url)) {
      const cached = cache.get(req.url)
      addHeaders(res, cached.headers)
      send(res, 200, cached.data)
      return
    }

    proxy.web(req, res)
  }
}

function addHeaders(res, headers) {
  for (let header in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, header)) {
      res.setHeader(header, headers[header])
    }
  }
}

function clearCache() {
  cache.reset()
  logger.info('cache cleared')
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
    headers: { Authorization: `Bearer ${token}` }
  }

  return httpProxy.createProxyServer(options)
    .on('proxyRes', cacheResponse)
    .on('error', handleError)
}

async function cacheResponse(proxyRes, { url: key }, res) {
  const { status, statusText, headers } = proxyRes
  try {
    const data = await json(proxyRes)
    cache.set(key, {
      status,
      statusText,
      headers: {
        ...headers,
        'X-contentful-cache': 'hit',
        'X-contentful-cache-time': new Date().toISOString(),
      },
      data,
    })
    send(res, 200, data)

  } catch (e) {
    console.error(e)
    send(res, 400)
  }
}

function getContentfulUrl() {
  return `https://cdn.contentful.com`
}

function handleError(err, req, res) {
  sendError(req, res, err)
}

const config = {
  accessToken: process.env['CONTENTFUL_ACCESS_TOKEN'],
}
module.exports = createProxyFn(config)

import logger from '../logger.js'

export function middlewareLogger(req, res, next) {
    logger.info(`📝 ${req.method} ${req.url}`);
    next()
}

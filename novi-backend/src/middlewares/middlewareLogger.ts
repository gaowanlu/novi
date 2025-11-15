import logger from '../logger.js'
import type { IRequest } from '../comm/request.js';
import type { Response, NextFunction } from 'express';

export function middlewareLogger(req: IRequest, res: Response, next: NextFunction) {
    logger.info(`📝 ${req.method} ${req.url}`);
    next()
}

import jwt, { JwtPayload } from "jsonwebtoken";
import { redisClient } from "../db/dbRedis.js";
import logger from "../logger.js";
import type { NextFunction, Response } from 'express'
import type { IRequest } from "../comm/request.js";

const JWT_SECRET = process.env.NOVI_JWT_SECRET as string;

/**
 * 中间件：JWT 认证
 * @param req - 请求对象
 * @param res - 响应对象
 * @param next - 下一个中间件函数
 * @returns 
 */
async function middlewareAuth(req: IRequest, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.header('authorization');

    if (!authHeader) {
        res.status(401).json({ message: '未提供token' });
        return;
    }

    try {
        const tokenParts = authHeader.split(' ');
        if (tokenParts.length != 2) {
            res.status(401).json({ message: 'Token已失效' });
            return;
        }
        const token = tokenParts[1];

        const decoded: JwtPayload = jwt.verify(token, JWT_SECRET) as JwtPayload;

        // 从Redis验证是否还有效
        const cacheToken = await redisClient.get(`user:auth:${decoded._id}`);
        if (cacheToken !== token) {
            res.status(401).json({ message: 'Token已失效' });
            return;
        }
        req.noviUser = decoded;
        next();
    } catch (err) {
        logger.error(`${err instanceof Error ? err.message : '未知错误'}`);
        res.status(401).json({ message: 'Token无效或过期' });
    }
};

export default middlewareAuth;

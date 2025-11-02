import jwt from "jsonwebtoken";
import { redisClient } from "../db/dbRedis.js";
import logger from "../logger.js";

const JWT_SECRET = process.env.NOVI_JWT_SECRET;

async function middlewareAuth(req, res, next) {
    const authHeader = req.header('authorization');
    if (!authHeader) {
        return res.status(401).json({ message: '未提供token' });
    }

    try {
        let token = authHeader.split(' ');
        if (token.length != 2) {
            return res.status(401).json({ message: 'Token已失效' });
        }
        token = token[1];

        const decoded = jwt.verify(token, JWT_SECRET);

        // 从Redis验证是否还有效
        const cacheToken = await redisClient.get(`user:auth:${decoded._id}`);
        if (cacheToken !== token) {
            return res.status(401).json({ message: 'Token已失效' });
        }
        req.noviUser = decoded;
        next();
    } catch (err) {
        logger.error(`${err.message}`);
        res.status(401).json({ message: 'Token无效或过期' });
    }
};

export default middlewareAuth;

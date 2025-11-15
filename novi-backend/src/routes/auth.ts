import { Router } from "express";
import type { RequestHandler, Response } from "express";
import type { IRequest } from "../comm/request.js";
import { User } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import crypto from 'crypto'
import { redisClient } from "../db/dbRedis.js";
import jwt from 'jsonwebtoken'

const router = Router();

const JWT_SECRET = process.env.NOVI_JWT_SECRET ?? '';
const JWT_TOKEN_TTL = Number.parseInt(process.env.NOVI_JWT_TOKEN_TTL ?? '3600', 10) || 3600;

// POST login/
const postLoginSchema = Joi.object({
    email: Joi.string().trim().email().required(),
    password: Joi.string().trim().min(8).max(20).required()
});
const loginHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const { email, password } = req.body as { email: string, password: string };

    try {
        const userByEmail = await User.findOne({ email }).select('_id userName email password passwordSalt').lean();
        if (!userByEmail) {
            res.status(400).json({ message: '用户未注册' });
            return
        }

        const salt = userByEmail.passwordSalt
        const storedPassword = userByEmail.password
        const hashedPassword = crypto.createHash('sha256').update(password + salt).digest('hex')

        if (hashedPassword !== storedPassword) {
            res.status(400).json({ message: '密码不正确请重试' })
            return
        }

        const userId = String((userByEmail as any)._id)
        const newToken = jwt.sign({ _id: userId }, JWT_SECRET)

        // 保存 token 到 redis，带 TTL
        await redisClient.set(`user:auth:${userId}`, newToken, { EX: JWT_TOKEN_TTL })

        res.status(200).json({
            jwtToken: newToken,
            userId,
            userName: userByEmail.userName,
            email: userByEmail.email,
        })
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: `${err.message}` });
    }
};
router.post('/login', middlewareValidate(postLoginSchema), loginHandler);

// GET token/verify
const tokenVerifyHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    res.status(200).json({});
};
router.get('/token/verify', middlewareAuth, tokenVerifyHandler);

// GET logout/
const logoutHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const _id = req.noviUser?._id;

        await redisClient.del(`user:auth:${_id}`);
        res.status(200).json({ message: '成功登出' });
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: `${err.message}` });
    }
}
router.get('/logout', middlewareAuth, logoutHandler);

// GET heartbeat/
const heartbeatHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const _id = req.noviUser?._id;

        // 更新redis token过期时间
        const token = await redisClient.get(`user:auth:${_id}`);
        if (token) {
            await redisClient.expire(`user:auth:${_id}`, JWT_TOKEN_TTL);
            res.status(200).json({ message: '心跳成功 已续费' });
            return
        }

        res.status(401).json({ message: 'Token已失效' });
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: `${err.message}` });
    }
}

router.get('/heartbeat', middlewareAuth, heartbeatHandler);

export default router;

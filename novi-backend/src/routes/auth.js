import { Router } from "express";
import { User } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import crypto from 'crypto'
import { redisClient } from "../db/dbRedis.js";
import jwt from 'jsonwebtoken'

const router = Router();

const JWT_SECRET = process.env.NOVI_JWT_SECRET;
const JWT_TOKEN_TTL = parseInt(process.env.NOVI_JWT_TOKEN_TTL);

// POST login/
const postLoginSchema = Joi.object({
    email: Joi.string().trim().email().required(),
    password: Joi.string().trim().min(8).max(20).required()
});
router.post('/login', middlewareValidate(postLoginSchema), async (req, res) => {
    const { email, password } = req.body;

    try {
        const userByEmail = await User.findOne({ email }).select('_id userName email password passwordSalt');
        if (!userByEmail) {
            return res.status(400).json({ message: '用户未注册' });
        }

        let hashedPassword = crypto.createHash('sha256').update(password + userByEmail.passwordSalt).digest('hex');
        if (hashedPassword !== userByEmail.password) {
            return res.status(400).json({ message: '密码不正确请重试' });
        }

        // 密码验证成功 生成JWT JWT本身不设置过期时间
        const newToken = jwt.sign({ _id: userByEmail._id }, JWT_SECRET);
        // 保存token到redis里带TTL
        await redisClient.set(`user:auth:${userByEmail._id}`, newToken, { EX: JWT_TOKEN_TTL });

        res.status(200).json({ jwtToken: newToken });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// GET token/verify
router.get('/token/verify', middlewareAuth, async (req, res) => {
    res.status(200).json({});
});

// GET logout/
router.get('/logout', middlewareAuth, async (req, res) => {
    try {
        const { _id } = req.noviUser;
        await redisClient.del(`user:auth:${_id}`);
        res.status(200).json({ message: '成功登出' });
    } catch (err) {
        res.status(500).json({ message: `${err.message}` });
    }
});

// GET heartbeat/
router.get('/heartbeat', middlewareAuth, async (req, res) => {
    try {
        const { _id } = req.noviUser;
        // 更新redis token过期时间
        const token = await redisClient.get(`user:auth:${_id}`);
        if (token) {
            await redisClient.expire(`user:auth:${_id}`, JWT_TOKEN_TTL);
            return res.status(200).json({ message: '心跳成功 已续费' });
        }

        res.status(401).json({ message: 'Token已失效' });
    } catch (err) {
        res.status(500).json({ message: `${err.message}` });
    }
});

export default router;

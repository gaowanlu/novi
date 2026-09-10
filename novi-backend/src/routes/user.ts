import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import type { IRequest } from '../comm/request.js';
import { User, FriendRequest } from '../models/mongoModel.js';
import type { IUser } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import crypto from 'crypto'
import { redisClient } from '../db/dbRedis.js';
import { isDuplicateKeyError } from '../models/mongoConstants.js';

const router = Router();

// POST user/
const postUserSchema = Joi.object({
    userName: Joi.string().trim().min(3).max(20).required(),
    email: Joi.string().trim().email().required(),
    password: Joi.string().trim().min(8).max(20).required()
});
const postUserHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    const { userName, email, password } = req.body;

    try {
        const userByUserName = await User.findOne({ userName }).select('_id userName');
        if (userByUserName) {
            res.status(400).json({ message: '用户名已被占用' });
            return
        }
        const userByEmail = await User.findOne({ email }).select('_id email');
        if (userByEmail) {
            res.status(400).json({ message: '邮箱已被注册' });
            return
        }

        let passwordSalt = crypto.randomBytes(16).toString('hex');
        let hashedPassword = crypto.createHash('sha256').update(password + passwordSalt).digest('hex');

        const newUser = new User({
            userName,
            email,
            password: hashedPassword,
            passwordSalt
        });
        const savedUser = await newUser.save();
        logger.info(`用户已创建 ${userName} ${email}`);

        const resultUser = await User.findOne({ _id: savedUser._id }).select('_id userName email');
        if (!resultUser) {
            res.status(500).json({ message: '创建失败' });
            return
        }

        res.status(200).json(resultUser.toJSON());
    } catch (err: unknown) {
        if (isDuplicateKeyError(err)) {
            const keys = Object.keys(err.keyValue ?? {});
            const message = keys.includes('email') ? '邮箱已被注册' : '用户名已被占用';
            res.status(400).json({ message });
            return
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`${msg}`);
        res.status(500).json({ message: '内部错误' });
    }
};
router.post('/',
    middlewareValidate(postUserSchema),
    postUserHandler);

// GET user/getAll 需要登录。仅返回「与我相关」的用户（好友/好友请求中出现的对方），
// 不再全量返回，避免越权枚举全体用户。
router.get('/getAll',
    middlewareAuth,
    async (req: IRequest, res: Response): Promise<void> => {
        const myUserId = req.noviUser?._id as string;
        try {
            // 取好友申请中「我」对端的用户ID（requester/receiver 中不等于我的一侧），含各状态历史
            const relatedIds = await FriendRequest.distinct(
                '$requester',
                { receiver: myUserId }
            );
            const relatedIds2 = await FriendRequest.distinct(
                '$receiver',
                { requester: myUserId }
            );
            const ids = [...new Set([...relatedIds, ...relatedIds2])].filter((id: unknown) => String(id) !== myUserId);
            const users = ids.length
                ? await User.find({ _id: { $in: ids } }).select('_id userName')
                : [];
            res.status(200).json(users);
        } catch (err: unknown) {
            const e = err instanceof Error ? err.message : String(err);
            logger.error(`${e}`);
            res.status(500).json({ message: '内部错误' });
        }
    }
);

// POST user/find
const postUserFindSchema = Joi.object({
    userName: Joi.string().trim().allow('').required(),
    _id: Joi.string().trim().allow('').required()
});
const postUserFindHandler: RequestHandler = async (req: IRequest, res: Response): Promise<void> => {
    try {
        const { userName, _id } = req.body;

        const conditions: { _id?: string; userName?: string }[] = [];
        if (_id && _id.trim() !== '') {
            conditions.push({ _id });
        }
        if (userName && userName.trim() !== '') {
            conditions.push({ userName });
        }
        if (conditions.length === 0) {
            res.status(400).json({ message: '至少需要提供 userName 或 _id' });
            return;
        }

        const users = await User.find(conditions.length > 0 ? { $or: conditions } : {}).select('_id userName');

        res.status(200).json(users);
    } catch (err: unknown) {
        const e = err instanceof Error ? err.message : String(err);
        logger.error(`${e}`);
        res.status(500).json({ message: '内部错误' });
    }
};
router.post('/find',
    middlewareAuth,
    middlewareValidate(postUserFindSchema),
    postUserFindHandler);

// POST user/delete
const postUserDeleteSchema = Joi.object({
    userName: Joi.string().trim().allow(''),
    email: Joi.string().trim().email().allow(''),
    _id: Joi.string().trim().allow(''),
}).custom((value, helpers) => {
    if (value.userName === '' &&
        value.email === '' &&
        value._id === '') {
        return helpers.error('至少需要提供 userName 或 email 或 _id');
    }
    return value;
});
router.post('/delete',
    middlewareAuth,
    middlewareValidate(postUserDeleteSchema),
    async (req: IRequest, res: Response): Promise<void> => {
        try {
            const myUserId = req.noviUser?._id;
            if (!myUserId) {
                res.status(401).json({ message: '未登录' });
                return
            }
            // 仅允许删除「自己」：匹配条件必须命中当前登录用户，否则会越权删除他人账号。
            // 直接用 _id 精确匹配，不再用 $or 兜底（空字符串条件在 Mongo 中是 falsy 匹配，易误读）。
            const selfMatch: { _id: string } = { _id: myUserId };

            const users = await User.find(selfMatch).select('_id userName email');

            if (users.length === 0) {
                res.status(404).json({ message: '未找到指定的用户' });
                return
            }

            await User.deleteOne(selfMatch);
            res.status(200).json(users);
        } catch (err: unknown) {
            const e = err instanceof Error ? err.message : String(err);
            logger.error(`${e}`);
            res.status(500).json({ message: '内部错误' });
        }
    }
);

// PUT user/
const putUserSchema = Joi.object({
    _id: Joi.string().trim().required(),
    userName: Joi.string().trim().min(3).max(20).required(),
    email: Joi.string().trim().email().required()
});
router.put('/',
    middlewareAuth,
    middlewareValidate(putUserSchema),
    async (req: IRequest, res: Response): Promise<void> => {
        try {
            const { userName, email, _id } = req.body;

            // 仅允许修改「自己」：_id 必须等于当前登录用户，且二者需一致，否则会越权改他人资料
            const myUserId = req.noviUser?._id;
            if (String(_id) !== String(myUserId)) {
                res.status(403).json({ message: '不能修改其他用户的资料' });
                return
            }

            const updatedUser = await User.findOneAndUpdate(
                { _id: myUserId },
                { $set: { userName, email } },
                { new: true, upsert: false } // new:false 返回当前旧的数据 true 返回新的
            ).select('_id userName email'); // upsert 没有则不要进行插入

            res.status(200).json(updatedUser);
        } catch (err: unknown) {
            if (isDuplicateKeyError(err)) {
                const keys = Object.keys(err.keyValue ?? {});
                const message = keys.includes('email') ? '邮箱已被注册' : '用户名已被占用';
                res.status(400).json({ message });
                return
            }
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`${msg}`);
            res.status(500).json({ message: '内部错误' });
        }
    }
);

// PUT user/password 修改登录密码：校验旧密码 → 换全新 salt+hash → 删当前 token 强制重登。
// 换 salt（而非只换 hash）：同密码不同账户的 salt 不同，避免同 hash 关联。
// 删 redis token 后，Redis 等值校验失效，该用户所有现存会话立即作废（与 logout 同源机制）。
const putUserPasswordSchema = Joi.object({
    oldPassword: Joi.string().trim().min(8).max(20).required(),
    newPassword: Joi.string().trim().min(8).max(20).required()
});
router.put('/password',
    middlewareAuth,
    middlewareValidate(putUserPasswordSchema),
    async (req: IRequest, res: Response): Promise<void> => {
        const myUserId = req.noviUser?._id;
        if (!myUserId) {
            res.status(401).json({ message: '未登录' });
            return;
        }
        const { oldPassword, newPassword } = req.body as { oldPassword: string, newPassword: string };

        try {
            const user = await User.findOne({ _id: myUserId }).select('password passwordSalt');
            if (!user) {
                res.status(404).json({ message: '用户不存在' });
                return;
            }

            // 1) 校验旧密码（sha256(oldPw + salt) 须等于存储的 hash）；恒定时间比较防计时攻击
            const expected = crypto.createHash('sha256').update(oldPassword + user.passwordSalt).digest('hex');
            const expectedBuf = Buffer.from(expected);
            const storedBuf = Buffer.from(user.password ?? '');
            if (expectedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(expectedBuf, storedBuf)) {
                res.status(400).json({ message: '当前密码不正确' });
                return;
            }

            // 2) 生成全新随机 salt + 哈希新密码，原子写入
            const newSalt = crypto.randomBytes(16).toString('hex');
            const newHash = crypto.createHash('sha256').update(newPassword + newSalt).digest('hex');
            await User.updateOne(
                { _id: myUserId },
                { $set: { password: newHash, passwordSalt: newSalt } }
            );

            // 3) 删当前设备 token：等值校验失效，强制重新登录
            await redisClient.del(`user:auth:${myUserId}`);

            logger.info(`用户已修改密码 ${myUserId}`);
            res.status(200).json({ message: '密码修改成功，请重新登录' });
        } catch (err: unknown) {
            const e = err instanceof Error ? err.message : String(err);
            logger.error(`${e}`);
            res.status(500).json({ message: '内部错误' });
        }
    }
);

export default router;

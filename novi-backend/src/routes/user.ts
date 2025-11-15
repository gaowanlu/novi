import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import type { IRequest } from '../comm/request.js';
import { User } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import logger from '../logger.js';
import crypto from 'crypto'

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
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
    }
};
router.post('/',
    middlewareValidate(postUserSchema),
    postUserHandler);

// GET user/getAll
router.get('/getAll',
    async (req: IRequest, res: Response): Promise<void> => {
        try {
            const users = await User.find().select('_id userName');
            res.status(200).json(users);
        } catch (err: any) {
            logger.error(`${err.message}`);
            res.status(500).json({ message: err.message });
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
        const { userName, email, _id } = req.body;

        const users = await User.find({
            $or: [
                { _id },
                { userName }
            ]
        }).select('_id userName');

        res.status(200).json(users);
    } catch (err: any) {
        logger.error(`${err.message}`);
        res.status(500).json({ message: err.message });
    }
};
router.post('/find',
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
    middlewareValidate(postUserDeleteSchema),
    async (req: IRequest, res: Response): Promise<void> => {
        try {
            const { userName, email, _id } = req.body;
            const users = await User.find({ $or: [{ userName }, { email }, { _id }] }).select('_id userName email');

            if (users.length === 0) {
                res.status(404).json({ message: '未找到指定的用户' });
                return
            }

            await User.deleteMany({ $or: [{ userName }, { email }, { _id }] });
            res.status(200).json(users);
        } catch (err: any) {
            logger.error(`${err.message}`);
            res.status(500).json({ message: err.message });
        }
    }
);

// PUT user/
const putUserSchema = Joi.object({
    _id: Joi.string().trim().required(),
    userName: Joi.string().trim().min(3).max(20).required(),
    email: Joi.string().trim().email().required()
});
router.put('/', middlewareValidate(putUserSchema),
    async (req: IRequest, res: Response): Promise<void> => {
        try {
            const { userName, email, _id } = req.body;

            const updatedUser = await User.findOneAndUpdate(
                { _id },
                { $set: { userName, email } },
                { new: true, upsert: false } // new:false 返回当前旧的数据 true 返回新的
            ).select('_id userName email'); // upsert 没有则不要进行插入

            res.status(200).json(updatedUser);
        } catch (err: any) {
            logger.error(`${err.message}`);
            res.status(500).json({ message: err.message });
        }
    }
);

export default router;

import { Router } from 'express'
import User from '../models/userModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import logger from '../logger.js';

const router = Router();

// POST user/
const postUserSchema = Joi.object({
    user_name: Joi.string().trim().min(3).max(20).required(),
    email: Joi.string().trim().email().required()
});
router.post('/', middlewareValidate(postUserSchema), async (req, res) => {
    const { user_name, email } = req.body;

    try {
        {
            const userByUserName = await User.findOne({ user_name });
            if (userByUserName) {
                return res.status(400).json({ error: '用户名已被占用' });
            }
            const userByEmail = await User.findOne({ email });
            if (userByEmail) {
                return res.status(400).json({ error: '邮箱已被注册' });
            }
        }

        const newUser = new User({
            user_name,
            email
        });
        const savedUser = await newUser.save();
        logger.info(`用户已创建 ${user_name} ${email}`);
        res.status(200).json(savedUser.toJSON());
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET user/getAll
router.get('/getAll', async (req, res) => {
    try {
        const users = await User.find();
        res.status(200).json(users);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST user/find
const postUserFindSchema = Joi.object({
    user_name: Joi.string().trim().allow('').required(),
    email: Joi.string().trim().email().allow('').required(),
    _id: Joi.string().trim().allow('').required()
});
router.post('/find', middlewareValidate(postUserFindSchema), async (req, res) => {
    try {
        const { user_name, email, _id } = req.body;

        const users = await User.find({
            $or: [
                { _id },
                { user_name },
                { email },
            ]
        });

        res.status(200).json(users);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST user/delete
const postUserDeleteSchema = Joi.object({
    user_name: Joi.string().trim().allow(''),
    email: Joi.string().trim().email().allow(''),
    _id: Joi.string().trim().allow(''),
}).custom((value, helpers) => {
    if (value.user_name === '' &&
        value.email === '' &&
        value._id === '') {
        return helpers.error('至少需要提供 user_name 或 email 或 _id');
    }
    return value;
});
router.post('/delete', middlewareValidate(postUserDeleteSchema), async (req, res) => {
    try {
        const { user_name, email, _id } = req.body;
        const users = await User.find({ $or: [{ user_name }, { email }, { _id }] });

        if (users.length === 0) {
            return res.status(404).json({ error: '未找到指定的用户' });
        }

        await User.deleteMany({ $or: [{ user_name }, { email }, { _id }] });
        res.status(200).json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT user/
const putUserSchema = Joi.object({
    _id: Joi.string().trim().required(),
    user_name: Joi.string().trim().min(3).max(20).required(),
    email: Joi.string().trim().email().required()
});
router.put('/', middlewareValidate(putUserSchema), async (req, res) => {
    try {
        const { user_name, email, _id } = req.body;

        const updatedUser = await User.findOneAndUpdate(
            { _id },
            { $set: { user_name, email } },
            { new: true, upsert: false }
        );

        res.status(200).json(updatedUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;

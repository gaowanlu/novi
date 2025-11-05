import { Router } from 'express';
import { User, FriendRequest, FriendMessage } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';

const router = Router();

// 向目标好友发送新消息
// POST message/
const postFriendMessage = Joi.object({
    noviCode: Joi.string().trim().min(1).max(10).required(),
    receiver: Joi.string().trim().min(10).max(100).required(),
    content: Joi.string().trim().min(1).max(200).required()
});
router.post('/', middlewareAuth, middlewareValidate(postFriendMessage), async (req, res) => {
    const myUserId = req.noviUser._id;
    const { noviCode, receiver, content } = req.body;
    if (receiver === myUserId) {
        res.status(400).json({ message: '无法向自己发送消息' });
    }

    try {
        // 检查二人是否为好友关系
        const friendRequest = await FriendRequest.findOne({
            $or: [
                { requester: myUserId, receiver: receiver },
                { requester: receiver, receiver: myUserId }
            ],
            status: {
                $in: ['accepted']
            }
        });
        if (!friendRequest) {
            return res.status(400).json({ message: '不能向非好友用户发送消息' });
        }

        // 新增一条消息
        const newFriendMessage = new FriendMessage({
            noviCode: noviCode,
            sender: myUserId,
            receiver: receiver,
            content: content,
            sentAt: new Date(),
        });
        const saveNewFriendMessage = await newFriendMessage.save();

        return res.status(200).json(saveNewFriendMessage);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 拉取与目标好友的聊天记录
// GET message/

// 接收者确认消息解密成功
// POST message/crypto/ack

export default router;

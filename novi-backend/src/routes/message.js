import { Router } from 'express';
import { User, FriendRequest, FriendMessage } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';
import mongoose from 'mongoose';

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

// 拉取与全部好友的消息未读情况
// GET message/allfriend
router.get('/allfriend', middlewareAuth, async (req, res) => {
    const myUserId = req.noviUser._id;

    try {
        const unreadMessages = await FriendMessage.aggregate([
            {
                $match: {
                    receiver: mongoose.Types.ObjectId.createFromHexString(myUserId),
                    readAt: null
                }
            },
            {
                $sort: { sentAt: -1 } // 先按时间倒序
            },
            {
                $group: {
                    _id: "$sender", // 按发送者分组
                    latestMessage: { $first: "$$ROOT" }, // 取每组的第一条（最新）
                    unreadCount: { $sum: 1 } // 统计未读数量
                }
            },
            {
                $lookup: { // 关联发送者用户信息
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "senderInfo"
                }
            },
            {
                $unwind: "$senderInfo"
            },
            {
                $project: {
                    _id: 0,
                    sender: "$_id",
                    unreadCount: 1, // 未读条数
                    content: "$latestMessage.content",
                    sentAt: "$latestMessage.sentAt",
                    lastMessageID: "$latestMessage._id",
                    noviCode: "$latestMessage.noviCode",
                    senderInfo: { userName: 1, _id: 1 }
                }
            },
            {
                $sort: { sentAt: -1 } // 按最新消息时间倒序排列发送者
            }
        ]);
        res.status(200).json(unreadMessages);
    } catch (err) {
        logger.error(`${err.message}`);
        return res.status(500).json({ message: err.message });
    }
});

// 拉取指定好友发送给自己的信息从第一条未读开始
// 也应该拉取到第一条未读的消息之前的最多10条用于消息显示
// 如果没有未读的信息则拉取最新的10条信息
// 如果指定了时间则表示拉取指定时间之前的最多30条消息
// GET message/pull/unread/byfriend
// const getMessagePullUnreadByFriend = Joi.object({
//     sender: Joi.string().trim().min(10).max(100).required()
// });
// router.get('/pull/unread/byfriend', middlewareAuth, middlewareValidate(getMessagePullUnreadByFriend), async (req, res) => {
//     const myUserId = req.noviUser._id;
// });

// 提供一个数组提交消息ID用于确认消息消息已读
// POST message/markreaded

// 接收者确认消息解密成功
// POST message/crypto/ack

export default router;

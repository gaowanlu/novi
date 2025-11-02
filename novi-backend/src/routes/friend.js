import { Router } from 'express';
import { User, FriendRequest } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';

const router = Router();

// POST friend/request
const postFriendRequest = Joi.object({
    targetUserId: Joi.string().trim().min(10).max(100).required()
});
router.post(
    '/request',
    middlewareAuth,
    middlewareValidate(postFriendRequest),
    async (req, res) => {
        const myUserId = req.noviUser._id;
        const targetUserId = req.body.targetUserId;
        if (myUserId === targetUserId) {
            return res.status(400).json({ message: '不能添加自己为好友' });
        }

        try {
            // 搜索目标好友用户是否存在
            const targetUser = await User.findOne({ _id: targetUserId }).select('_id');
            if (!targetUser) {
                return res.status(400).json({ message: '目标用户不存在' });
            }

            // 检查是否已经为好友关系了 没有确认的好友申请记录
            const existFriendRequest = await FriendRequest.findOne({
                status: {
                    $in: ['accepted', 'pending']
                },
                $or: [
                    { requester: myUserId, receiver: targetUserId },
                    { requester: targetUserId, receiver: myUserId }
                ]
            });
            if (existFriendRequest) {
                return res.status(200).json(existFriendRequest);
            }
            // 没有的话就增加一条请求记录
            const newFriendRequest = new FriendRequest({
                requester: myUserId,
                receiver: targetUserId,
                status: 'pending'
            });
            const saveNewFriendRequest = await newFriendRequest.save();

            return res.status(200).json(saveNewFriendRequest);
        } catch (err) {
            return res.status(500).json({ message: err.message });
        }
    }
);

// 修改好友申请状态
// PUT friend/request

// 删除好友关系
// DELETE friend/

// 取消好友申请
// DELETE friend/request

// 获取自己的所有好友
// GET friend/

export default router;

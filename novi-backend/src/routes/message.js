import { Router } from 'express';
import { User, FriendRequest, FriendMessage } from '../models/mongoModel.js';
import Joi from 'joi';
import middlewareValidate from '../middlewares/middlewareValidate.js';
import middlewareAuth from '../middlewares/middlewareAuth.js';
import logger from '../logger.js';

const router = Router();

// 向目标好友发送新消息
// POST message/

// 拉取与目标好友的聊天记录
// GET message/

// 接收者确认消息解密成功
// POST message/crypto/ack

export default router;

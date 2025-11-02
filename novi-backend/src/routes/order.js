import { Router } from 'express'
import { createOrder, selectOrderByuser_id, deleteOrderByIdAnduser_id } from '../models/postgresModel.js'
import logger from '../logger.js'
import Joi from 'joi'
import middlewareValidate from '../middlewares/middlewareValidate.js'

const router = Router()

// POST order/
const postOrderSchema = Joi.object({
    user_id: Joi.number().integer().required(),
    amount: Joi.number().integer().required()
});
router.post('/', middlewareValidate(postOrderSchema), async (req, res) => {
    try {
        const { user_id, amount } = req.body;
        const order = await createOrder(user_id, amount);
        res.status(201).json(order);
    } catch (err) {
        logger.error('创建订单失败：', err);
        res.status(500).json({ message: '服务器内部错误' });
    }
});

// GET order?user_id=
const getOrderSchema = Joi.object({
    user_id: Joi.number().integer(),
});
router.get('/', middlewareValidate(getOrderSchema, 'query'), async (req, res) => {
    try {
        const user_id = parseInt(req.query.user_id, 10);
        const orders = await selectOrderByuser_id(user_id);
        res.json(orders);
    } catch (err) {
        logger.error(`查询用户 ${req.params.user_id}的订单失败:`, err.message);
        res.status(500).json({ message: err.message });
    }
});

// DELTE order?id=&user_id=
const deleteOrderSchema = Joi.object({
    id: Joi.number().integer(),
    user_id: Joi.number().integer()
});
router.delete('/', middlewareValidate(deleteOrderSchema, 'query'), async (req, res) => {
    try {
        const orderId = parseInt(req.query.id, 10);
        const user_id = parseInt(req.query.user_id, 10);
        const deletedOrders = await deleteOrderByIdAnduser_id(orderId, user_id);
        res.json(deletedOrders);
    } catch (err) {
        logger.error(`删除用户${user_id}订单 ${orderId} 失败 `, err.message);
        res.status(500).json({ message: err.message });
    }
});

export default router;

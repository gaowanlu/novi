import { Router } from 'express'
import type { RequestHandler, Response, Request } from 'express'
import type { Order } from '../db/dbPostgres.js'
import { createOrder, selectOrderByUserId, deleteOrderByIdAndUserId } from '../models/postgresModel.js'
import logger from '../logger.js'
import Joi from 'joi'
import middlewareValidate from '../middlewares/middlewareValidate.js'

const router = Router()

// POST order/
const postOrderSchema = Joi.object({
    user_id: Joi.number().integer().required(),
    amount: Joi.number().integer().required()
});
const postOrderHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const { user_id, amount } = req.body as { user_id: number; amount: number }

        if (typeof user_id !== 'number' || Number.isNaN(user_id)) {
            res.status(400).json({ message: 'user_id 必须为整数' })
            return
        }
        if (typeof amount !== 'number' || Number.isNaN(amount)) {
            res.status(400).json({ message: 'amount 必须为整数' })
            return
        }

        const order: Order = await createOrder(user_id, amount)
        res.status(201).json(order)
    } catch (err: any) {
        logger.error(`创建订单失败: ${err.message}`)
        res.status(500).json({ message: err.message })
    }
}
router.post('/', middlewareValidate(postOrderSchema), postOrderHandler)

// GET order?user_id=
const getOrderSchema = Joi.object({
    user_id: Joi.number().integer(),
});
const getOrderHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const q = req.query as { user_id?: string }
        const userIdRaw = q.user_id
        if (!userIdRaw) {
            res.status(400).json({ message: '缺少 user_id 参数' })
            return
        }
        const user_id = parseInt(String(userIdRaw), 10)
        if (Number.isNaN(user_id)) {
            res.status(400).json({ message: 'user_id 非法' })
            return
        }

        const orders: Order[] = await selectOrderByUserId(user_id)
        res.status(200).json(orders)
    } catch (err: any) {
        logger.error(`查询订单失败: ${err.message}`)
        res.status(500).json({ message: err.message })
    }
};
router.get('/', middlewareValidate(getOrderSchema, 'query'), getOrderHandler);

// DELTE order?id=&user_id=
const deleteOrderSchema = Joi.object({
    id: Joi.number().integer(),
    user_id: Joi.number().integer()
});

const deleteOrderHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const q = req.query as { id?: string; user_id?: string }
        const idRaw = q.id
        const userIdRaw = q.user_id

        if (!idRaw || !userIdRaw) {
            res.status(400).json({ message: '缺少 id 或 user_id 参数' })
            return
        }

        const orderId = parseInt(String(idRaw), 10)
        const user_id = parseInt(String(userIdRaw), 10)

        if (Number.isNaN(orderId) || Number.isNaN(user_id)) {
            res.status(400).json({ message: 'id 或 user_id 非法' })
            return
        }

        const deleted = await deleteOrderByIdAndUserId(orderId, user_id)
        res.status(200).json(deleted)
    } catch (err: any) {
        logger.error(`删除订单失败: ${err.message}`)
        res.status(500).json({ message: err.message })
    }
};

router.delete('/', middlewareValidate(deleteOrderSchema, 'query'), deleteOrderHandler);

export default router;

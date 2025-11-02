import { pgPool } from '../db/dbPostgres.js'
import logger from '../logger.js'

async function createOrder(user_id, amount) {
    try {
        const result = await pgPool.query(
            'INSERT INTO orders (user_id, amount, created_at) VALUES ($1, $2, NOW()) RETURNING *',
            [user_id, amount]
        );
        return result.rows[0];
    } catch (err) {
        logger.error('创建订单失败：', err.message);
        throw err;
    }
};

async function selectOrderByuser_id(user_id) {
    try {
        const result = await pgPool.query(
            'SELECT* from orders where user_id=$1',
            [user_id]
        );
        return result.rows;
    } catch (err) {
        logger.error('检索订单失败：', err.message);
        throw err;
    }
}

async function deleteOrderByIdAnduser_id(id, user_id) {
    try {
        const result = await pgPool.query(
            'DELETE FROM orders WHERE id = $1 AND user_id = $2 RETURNING *',
            [id, user_id]
        );
        if (result.rowCount === 0) {
            logger.info(`没有找到订单 id=${id} 且 user_id=${user_id}，未删除任何记录`);
            return [];
        }
        return result.rows; // 返回被删除的订单
    } catch (err) {
        logger.error('删除订单失败：', err.message);
        throw err;
    }
}

export {
    createOrder,
    selectOrderByuser_id,
    deleteOrderByIdAnduser_id
};

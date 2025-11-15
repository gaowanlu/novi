import { pgPool } from '../db/dbPostgres.js'
import type { Order } from '../db/dbPostgres.js'
import logger from '../logger.js'
import type { QueryResult } from 'pg'

/**
 * 创建订单
 * @param user_id - 用户ID
 * @param amount - 订单金额 单位为分
 * @returns 新创建的订单对象
 */
async function createOrder(user_id: number, amount: number): Promise<Order> {
    try {
        const result: QueryResult<Order> = await pgPool.query(
            'INSERT INTO orders (user_id, amount, created_at) VALUES ($1, $2, NOW()) RETURNING *',
            [user_id, amount]
        );
        return result.rows[0];
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`创建订单失败: ${errorMessage}`)
        throw err
    }
};

/**
 * 根据用户ID查询订单
 * @param user_id  - 用户ID
 * @returns 订单列表
 */
async function selectOrderByUserId(user_id: number): Promise<Order[]> {
    try {
        const result: QueryResult<Order> = await pgPool.query(
            'SELECT* from orders where user_id=$1',
            [user_id]
        );
        return result.rows;
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`查询订单失败: ${errorMessage}`)
        throw err
    }
}

/**
 * 根据订单ID和用户ID删除订单
 * @param id - 订单ID
 * @param user_id - 用户ID
 * @returns 被删除的订单列表
 */
async function deleteOrderByIdAndUserId(id: number, user_id: number): Promise<Order[]> {
    try {
        const result: QueryResult<Order> = await pgPool.query(
            'DELETE FROM orders WHERE id = $1 AND user_id = $2 RETURNING *',
            [id, user_id]
        );
        if (result.rowCount === 0) {
            logger.info(`没有找到订单 id=${id} 且 user_id=${user_id}，未删除任何记录`);
            return [];
        }
        return result.rows; // 返回被删除的订单
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知错误'
        logger.error(`删除订单失败: ${errorMessage}`)
        throw err
    }
}

export {
    createOrder,
    selectOrderByUserId,
    deleteOrderByIdAndUserId
};

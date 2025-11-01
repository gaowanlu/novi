import { pgPool } from '../db/dbPostgres';

export async function createOrder(userId, amount) {
    const result = await pgPool.query(
        'INSERT INTO orders (user_id, amount, created_at) VALUES ($1, $2, NOW()) RETURNING *',
        [userId, amount]
    );
    return result.rows[0];
};

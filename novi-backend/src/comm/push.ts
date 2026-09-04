import logger from '../logger.js'
import { noviNodeIPC } from '../mq/noviNodeIPC.js'
import { redisClient } from '../db/dbRedis.js'

/**
 * 推送消息给一组在线用户
 * 流程：读 redis 取各用户在线所在节点 -> 通过节点间消息队列发往对应节点 -> 由该节点推送给本地 socket
 * 离线用户静默跳过；单个用户推送失败不影响其它用户
 * @param userIds - 目标用户ID列表
 * @param event - Socket.IO 事件名
 * @param message - 推送内容（对象或数组，经 JSON 序列化后随节点消息传输）
 */
export async function pushToUsers(userIds: string[], event: string, message: object | object[]): Promise<void> {
    await Promise.allSettled(userIds.map(async (userId: string) => {
        const onlineNode = await redisClient.get(`user:online:${userId}`)
        if (!onlineNode) return
        const msg = noviNodeIPC.createNewMessage(userId, event, message)
        if (msg) {
            noviNodeIPC.sendToNode(onlineNode, msg)
        }
    }))
}

/**
 * 推送失败时的统一日志（各调用点捕获异常后使用）
 */
export function logPushError(event: string, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err))
    logger.error(`[push] ${event} 推送异常: ${e.message}`)
}

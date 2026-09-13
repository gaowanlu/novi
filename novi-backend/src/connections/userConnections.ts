import { Server, Socket } from 'socket.io'
import type { Server as HttpServer } from 'http'
import logger from '../logger.js';
import { redisClient } from "../db/dbRedis.js";
import { verifyToken } from '../config/jwt.js';
import type { NoviUser } from '../comm/noviUser.js';

// 扩展 Socket 接口，添加自定义属性
interface NoviSocket extends Socket {
    noviUser?: NoviUser & {
        latestHeartbeatTimestamp?: number
    }
}

// 用户连接管理类
// 负责 WebSocket 连接的认证、管理和事件处理
class UserConnections {
    socketIOServer: Server | null = null;
    userId2Sockets = new Map<string, Set<NoviSocket>>();

    /**
     * 初始化 Socket.IO 服务器
     * @param httpServer - HTTP 服务器实例
     */
    public init(httpServer: HttpServer): void {
        this.socketIOServer = new Server(httpServer, {
            path: '/api/ws',
            cors: {
                origin: process.env.NOVI_SOCKETIO_CORS_ORIGIN
            }
        });

        // JWT 认证中间件
        this.socketIOServer.use(async (socket: NoviSocket, next): Promise<void> => {
            if (socket.noviUser) {
                return next();
            }

            const tokenRaw = socket.handshake?.auth?.token;
            if (typeof tokenRaw !== 'string' || tokenRaw.trim() === '') {
                return next(new Error("缺少认证信息"));
            }
            const token = tokenRaw as string;

            try {
                const decodedRaw = verifyToken(token);
                if (!decodedRaw || typeof decodedRaw !== 'object') {
                    return next(new Error('认证信息不匹配'));
                }
                // 最小的类型保护：必须包含_id且为string
                if (!("_id" in decodedRaw) || typeof decodedRaw._id !== "string") {
                    return next(new Error("认证信息不匹配"));
                }

                const decoded = decodedRaw as NoviUser;

                const cacheToken = await redisClient.get(`user:auth:${decoded._id}`);
                if (cacheToken !== token) {
                    return next(new Error("认证信息不匹配"));
                }

                socket.noviUser = decoded;
                return next();

            } catch (err: unknown) {
                if (err instanceof Error) {
                    logger.error(`JWT 验证失败：${err.message}`);
                } else {
                    logger.error(`JWT 验证失败：${String(err)}`);
                }
                return next(new Error("认证失败"));
            }
        });

        // 连接事件
        this.socketIOServer.on('connection', async (socket: NoviSocket): Promise<void> => {
            await this.onConnect(socket);

            socket.on("message", async (msg: string): Promise<void> => {
                await this.OnMessage(socket, msg);
            });

            socket.on("disconnect", async (): Promise<void> => {
                await this.onDisconnect(socket);
            });

            socket.on("noviheartbeat", async (msg: string): Promise<void> => {
                await this.OnHeartbeat(socket, msg);
            });
        });

        // 定时打印在线用户（保持原行为）
        const interval = setInterval(() => {
            const allOnlineUserId: string[] = [];
            this.userId2Sockets.forEach((sockets, userId) => {
                allOnlineUserId.push(userId);
            });
            logger.error(
                `所有在线用户=> 数量 ${allOnlineUserId.length} 用户ID ${allOnlineUserId.join(",")}`
            );
        }, 5000);
        // 不阻止进程退出：shutdown 时由 gracefulShutdown 关闭 HTTP server，
        // socket.io server 关闭后该 interval 自然失效，但显式 unref 更安全
        interval.unref();
    }

    private async onConnect(socket: NoviSocket): Promise<void> {
        logger.error(`用户已连接: socketId ${socket.id} userId ${socket.noviUser?._id}`);
        if (socket.noviUser) {
            try {
                // 300秒5分钟
                await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, {
                    EX: 60 * 5,
                });
                // 支持多设备/多标签页：同一用户可持有多个 socket
                let sockets = this.userId2Sockets.get(socket.noviUser._id);
                if (!sockets) {
                    sockets = new Set();
                    this.userId2Sockets.set(socket.noviUser._id, sockets);
                }
                sockets.add(socket);
            } catch (err: unknown) {
                const e = err instanceof Error ? err : new Error(String(err));
                logger.error(`新用户连接 ${e.message}`);
            }
        }
    }

    private async onDisconnect(socket: NoviSocket): Promise<void> {
        let noviUserId: string = "";
        if (socket.noviUser) {
            noviUserId = socket.noviUser._id;
        }
        logger.error(`用户断开: socketId ${socket.id} userId ${noviUserId}`);

        if (noviUserId === "") {
            logger.error(`onDistconnect noviUserId==''`);
            return;
        }

        // 从 Set 中移除该 socket；若用户已无活跃连接则清除整条记录并下线
        const sockets = this.userId2Sockets.get(noviUserId);
        if (sockets) {
            sockets.delete(socket);
            if (sockets.size === 0) {
                this.userId2Sockets.delete(noviUserId);
            }
        }

        // 只有当该用户在本节点已无任何 socket 时才清除 Redis 在线状态，
        // 避免多设备场景下断开一个设备导致其它设备被误判离线
        if (!this.userId2Sockets.has(noviUserId)) {
            try {
                await redisClient.DEL(`user:online:${noviUserId}`);
                logger.error(`删除用户在线状态 user:online:${noviUserId} 成功`);
            } catch (err: unknown) {
                const e = err instanceof Error ? err : new Error(String(err));
                logger.error(`用户断开 ${e.message}`);
            }
        }
    }


    private async OnMessage(socket: NoviSocket, msg: string): Promise<void> {
        // 原始占位逻辑（保持不变）
        // logger.error(`WS socketId ${socket.id} userId ${socket.noviUser._id} 收到消息 ${msg}`);
    }

    private async OnHeartbeat(socket: NoviSocket, msg: string): Promise<void> {
        if (!socket.noviUser) {
            logger.error(`OnHeartbeat !socket.noviUser`);
            return;
        }

        logger.error(`WS heartbeat ${socket.noviUser._id} 收到消息 ${msg}`);

        if (socket.noviUser.latestHeartbeatTimestamp) {
            // 三分钟内不更新redis减轻压力（保持原逻辑）
            if (Date.now() - socket.noviUser.latestHeartbeatTimestamp <= 60 * 3 * 1000) {
                return;
            }
        }

        try {
            // 300秒5分钟（保持原来用法）
            await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, {
                EX: 60 * 5,
            });
            logger.error(`更新在线状态 user:online:${socket.noviUser._id} ${process.env.NOVI_NODE} 成功`);
            socket.noviUser.latestHeartbeatTimestamp = Date.now();

            this.eventMessageForClientByUserId(socket.noviUser._id, "noviheartbeat", "");
        } catch (err: unknown) {
            const e = err instanceof Error ? err : new Error(String(err));
            logger.error(`WS heartbeat ${e.message}`);
        }
    }

    // 向该用户在本节点的所有 socket fan-out（多设备/多标签页都能收到）
    public eventMessageForClientByUserId(userId: string, eventName: string, msg: object | string) {
        const sockets = this.userId2Sockets.get(userId);
        if (!sockets || sockets.size === 0) {
            logger.error(
                `eventMessageForClientByUserId failed userId ${userId} eventName ${eventName} msg ${msg}`
            );
            return;
        }
        for (const s of sockets) {
            s.emit(eventName, msg);
        }
    }
}

export const userConnections = new UserConnections();
export default userConnections;

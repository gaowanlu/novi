import { Server, Socket } from 'socket.io'
import logger from '../logger.js';
import { redisClient } from "../db/dbRedis.js";
import jwt from 'jsonwebtoken';

// JWT 解码后的用户信息接口
interface NoviUser {
    _id: string
    [key: string]: any
}

// 扩展 Socket 接口，添加自定义属性
interface NoviSocket extends Socket {
    noviUser?: NoviUser & {
        latestHeartbeatTimestamp?: number
    }
}

// 用户连接管理类
// 负责 WebSocket 连接的认证、管理和事件处理
const userConnections = {
    socketIOServer: null as Server | null,
    userId2Socket: new Map<string, NoviSocket>(),

    /**
     * 初始化 Socket.IO 服务器
     * @param httpServer - HTTP 服务器实例
     */
    init(httpServer: any): void {
        this.socketIOServer = new Server(httpServer, {
            path: '/api/ws',
            cors: {
                origin: process.env.NOVI_SOCKETIO_CORS_ORIGIN
            },
        });

        // JWT 认证中间件
        this.socketIOServer.use(async (socket: NoviSocket, next): Promise<void> => {
            if (socket.noviUser) {
                return next();
            }

            const token = socket.handshake.auth.token as string;
            if (!token) {
                return next(new Error("缺少认证信息"));
            }

            try {
                // 验证JWT
                const decoded: NoviUser = jwt.verify(token, process.env.NOVI_JWT_SECRET as string) as NoviUser;

                const cacheToken = await redisClient.get(`user:auth:${decoded._id}`);
                if (cacheToken !== token) {
                    return next(new Error("认证信息不匹配"));
                }

                socket.noviUser = decoded;
                return next();
            } catch (err) {
                // logger.error(`JWT 验证失败：${err.message}`);
                return next(new Error("认证失败"))
            }
        });

        this.socketIOServer.on('connection', async (socket: NoviSocket): Promise<void> => {
            await this.onConnect(socket);

            socket.on('message', async (msg: string): Promise<void> => {
                await this.OnMessage(socket, msg);
            });

            socket.on("disconnect", async (): Promise<void> => {
                await this.onDisconnect(socket);
            });

            socket.on('noviheartbeat', async (msg: string): Promise<void> => {
                await this.OnHeartbeat(socket, msg);
            });
        });

        setInterval(() => {
            let allOnlineUserId: Array<string> = [];
            this.userId2Socket.forEach((v: NoviSocket, k: string, map: Map<string, NoviSocket>) => {
                allOnlineUserId.push(k);
            });
            logger.error(`所有在线用户=> 数量 ${allOnlineUserId.length} 用户ID ${allOnlineUserId.join(',')}`);
        }, 5000);
    },

    async onConnect(socket: NoviSocket): Promise<void> {
        logger.error(`用户已连接: socketId ${socket.id} userId ${socket.noviUser?._id}`);
        if (socket.noviUser) {
            try {
                // 300秒5分钟
                await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, { EX: 60 * 5 });
                this.userId2Socket.set(socket.noviUser._id, socket);
            } catch (err) {
                const e = err as Error;
                logger.error(`新用户连接 ${e.message}`);
            }
        }
    },

    async onDisconnect(socket: NoviSocket): Promise<void> {
        let noviUserId: string = '';
        if (socket.noviUser) {
            noviUserId = socket.noviUser._id;
        }
        logger.error(`用户断开: socketId ${socket.id} userId ${noviUserId}`);

        if (noviUserId === '') {
            logger.error(`onDistconnect noviUserId==''`);
            return;
        }

        this.userId2Socket.delete(noviUserId);

        try {
            await redisClient.DEL(`user:online:${noviUserId}`);
            logger.error(`删除用户在线状态 user:online:${noviUserId} 成功`);
        } catch (err) {
            const e = err as Error;
            logger.error(`用户断开 ${e.message}`);
        }
    },

    async OnMessage(socket: NoviSocket, msg: string): Promise<void> {
        // logger.error(`WS socketId ${socket.id} userId ${socket.noviUser._id} 收到消息 ${msg}`);
    },

    async OnHeartbeat(socket: NoviSocket, msg: string): Promise<void> {
        if (!socket.noviUser) {
            logger.error(`OnHeartbeat !socket.noviUser`);
            return;
        }

        logger.error(`WS heartbeat ${socket.noviUser._id} 收到消息 ${msg}`);

        if (socket.noviUser.latestHeartbeatTimestamp) {
            // 三分钟内不更新redis减轻压力
            if (Date.now() - socket.noviUser.latestHeartbeatTimestamp <= 60 * 3 * 1000) {
                return;
            }
        }

        try {
            // 300秒5分钟
            await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, { EX: 60 * 5 });
            logger.error(`更新在线状态 user:online:${socket.noviUser._id} ${process.env.NOVI_NODE} 成功`);
            socket.noviUser.latestHeartbeatTimestamp = Date.now();

            this.eventMessageForClientByUserId(socket.noviUser._id, 'noviheartbeat', "");
        } catch (err) {
            const e = err as Error
            logger.error(`WS heartbeat ${e.message}`);
        }
    },

    eventMessageForClientByUserId(userId: string, eventName: string, msg: object | string) {
        let clientSocket = this.userId2Socket.get(userId);
        if (!clientSocket) {
            logger.error(`eventMessageForClientByUserId failed userId ${userId} eventName ${eventName} msg ${msg}`);
            return;
        }
        clientSocket.emit(eventName, msg);
    }
};

export { userConnections };

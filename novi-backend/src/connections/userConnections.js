import { Server } from 'socket.io'
import logger from '../logger.js';
import { redisClient } from "../db/dbRedis.js";
import jwt from "jsonwebtoken";

const userConnections = {
    socketIOServer: null,
    init(httpServer) {
        this.socketIOServer = new Server(httpServer, {
            path: '/ws',
            cors: {
                origin: process.env.NOVI_SOCKETIO_CORS_ORIGIN
            },
        });
        this.socketIOServer.use(async (socket, next) => {
            if (socket.noviUser) {
                return next();
            }

            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error("缺少认证信息"));
            }

            try {
                // 验证JWT
                const decoded = jwt.verify(token, process.env.NOVI_JWT_SECRET);

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

        this.socketIOServer.on('connection', async (socket) => {
            await this.onConnect(socket);

            socket.on('message', async (msg) => {
                await this.OnMessage(socket, msg);
            });

            socket.on("disconnect", async () => {
                await this.onDisconnect(socket);
            });

            socket.on('noviheartbeat', async (msg) => {
                await this.OnHeartbeat(socket, msg);
            });
        });
    },
    async onConnect(socket) {
        logger.error(`用户已连接: socketId ${socket.id} userId ${socket.noviUser._id}`);
        try {
            // 300秒5分钟
            await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, { EX: 60 * 5 });
        } catch (err) {
            logger.error(`新用户连接 ${err.message}`);
        }
    },
    async onDisconnect(socket) {
        let noviUserId = '';
        if (socket.noviUser) {
            noviUserId = socket.noviUser._id;
        }
        logger.error(`用户断开: socketId ${socket.id} userId ${noviUserId}`);

        try {
            await redisClient.DEL(`user:online:${noviUserId}`);
            logger.error(`删除用户在线状态 user:online:${noviUserId} 成功`);
        } catch (err) {
            logger.error(`用户断开 ${err.message}`);
        }
    },
    async OnMessage(socket, msg) {
        // logger.error(`WS socketId ${socket.id} userId ${socket.noviUser._id} 收到消息 ${msg}`);
    },
    async OnHeartbeat(socket, msg) {
        logger.error(`WS heartbeat ${socket.noviUser._id} 收到消息 ${msg}`);
        try {
            // 300秒5分钟
            await redisClient.SET(`user:online:${socket.noviUser._id}`, `${process.env.NOVI_NODE}`, { EX: 60 * 5 });
            logger.error(`更新在线状态 user:online:${socket.noviUser._id} ${process.env.NOVI_NODE} 成功`);
        } catch (err) {
            logger.error(`新用户连接 ${err.message}`);
        }
    }
};

export { userConnections };

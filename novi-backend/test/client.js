import { io } from "socket.io-client";

const BASE_URL = 'http://localhost:3000'; // 改成你的服务器地址
const REGISTER_URL = `${BASE_URL}/api/user`;
const LOGIN_URL = `${BASE_URL}/api/auth/login`;
const VERIFY_URL = `${BASE_URL}/api/auth/token/verify`;
const HEARTBEAT_URL = `${BASE_URL}/api/auth/heartbeat`;
const LOGOUT_URL = `${BASE_URL}/api/auth/logout`;

const userData = {
    userName: '新用户7',
    email: '2209120831@qq.com',
    password: '123456789'
};

let jwtToken = null;
let heartbeatTimer = null;

// POST 请求封装
async function postJson(url, data, headers = {}) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(data),
        });
        const json = await res.json();
        return { status: res.status, json };
    } catch (err) {
        console.error(`[请求错误] ${url}`, err);
        return { status: 0, json: null };
    }
}

// GET 请求封装
async function getRequest(url, headers = {}) {
    try {
        const res = await fetch(url, { headers });
        const json = await res.json();
        return { status: res.status, json };
    } catch (err) {
        console.error(`[GET错误] ${url}`, err);
        return { status: 0, json: null };
    }
}

// 程序主逻辑
async function main() {
    console.log('➡️ 开始注册用户...');
    const registerRes = await postJson(REGISTER_URL, userData);

    if (registerRes.status === 200) {
        console.log('✅ 注册成功:', registerRes.json);
    } else {
        console.warn('⚠️ 注册失败 (可能用户已存在):', registerRes.json);
    }

    // 登录
    const loginRes = await postJson(LOGIN_URL, {
        email: userData.email,
        password: userData.password
    });

    if (loginRes.status === 200 && loginRes.json.jwtToken) {
        jwtToken = loginRes.json.jwtToken;
        console.log('✅ 登录成功，JWT:', loginRes.json);
    } else {
        console.error('❌ 登录失败:', loginRes.json);
        return;
    }

    // 验证 Token
    console.log('🔍 验证 token...');
    const verifyRes = await getRequest(VERIFY_URL, {
        Authorization: `Bearer ${jwtToken}`
    });

    if (verifyRes.status === 200) {
        console.log('✅ Token 验证成功:', verifyRes.json);
    } else {
        console.error('❌ Token 验证失败:', verifyRes.json);
        return;
    }

    // 定时心跳
    console.log('💓 开始定时心跳，每2分钟续期一次...');
    async function heartbeat() {
        const res = await getRequest(HEARTBEAT_URL, {
            Authorization: `Bearer ${jwtToken}`
        });
        if (res.status === 200) {
            console.log('❤️ 心跳成功:', new Date().toLocaleString());
        } else {
            console.error('💔 心跳失败:', res.json);
            clearInterval(heartbeatTimer);
        }
    }

    await heartbeat();
    heartbeatTimer = setInterval(heartbeat, 2 * 60 * 1000);

    // 创建socket.io客户端
    const socketIOClient = await testUserConnect(jwtToken);
    socketIOClient.on("connect", () => {
        console.log("✅ 已成功连接到服务器");
        socketIOClient.emit('noviheartbeat', '');

        // setInterval(() => {
        //     socketIOClient.emit('message', 'hello world');
        // }, 1000);

        setInterval(() => {
            socketIOClient.emit('noviheartbeat', '');
        }, 10000);
    });
    socketIOClient.on('novi_friend_request_comming', (msg) => {
        console.log('novi_friend_request_comming', msg);
    });
    socketIOClient.on('novi_friend_request_processed', (msg) => {
        console.log('novi_friend_request_processed', msg);
    });
    socketIOClient.on('novi_friend_friend_deleted', (msg) => {
        console.log('novi_friend_friend_deleted', msg);
    });
    socketIOClient.on('novi_friend_message_comming', (msg) => {
        console.log('novi_friend_message_comming', msg);
    });
    socketIOClient.on('novi_friend_message_readed', (msg) => {
        console.log('novi_friend_message_readed', msg);
    });
    socketIOClient.on('novi_friend_message_crypto_ack', (msg) => {
        console.log('novi_friend_message_crypto_ack', msg);
    });
    socketIOClient.on('noviheartbeat', (msg) => {
        console.log('noviheartbeat', msg);
    });


    // 捕获 Ctrl+C 信号
    process.on('SIGINT', async () => {
        console.log('\n🛑 检测到退出信号，准备登出...');
        await logout();
        socketIOClient.close();
        process.exit(0);
    });
}

// 登出函数
async function logout() {
    if (!jwtToken) {
        console.log('ℹ️ 当前无有效 JWT，不需要登出');
        return;
    }
    try {
        const res = await fetch(LOGOUT_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'Content-Type': 'application/json'
            }
        });
        if (res.status === 200) {
            console.log('🚪 已成功退出登录');
        } else {
            const msg = await res.text();
            console.warn(`⚠️ 登出请求失败: ${res.status}`, msg);
        }
    } catch (err) {
        console.error('登出时出错:', err);
    }
}

// socket.io
async function testUserConnect(token) {
    const socket = io(BASE_URL, {
        path: "/api/ws",
        auth: {
            token // 携带认证信息
        },
    });


    socket.on("message", (msg) => {
        console.log("💬 收到消息:", msg);
    });

    socket.on("disconnect", () => {
        console.log("❌ 连接断开");
    });

    // ⚠️ 认证失败或连接错误
    socket.on("connect_error", (err) => {
        console.error("❌ 连接错误:", err.message);
    });

    return socket;
}

main();

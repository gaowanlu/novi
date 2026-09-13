// src/api/request.ts

// 单一 401 处理：清除本地会话并跳转登录页。
// 用模块级 flag 防止同一导航周期内被多次触发（apiFetch + 调用方可能都检查 401）。
let hasHandled401 = false;

export function handleSessionExpired(): void {
    if (hasHandled401) return;
    hasHandled401 = true;
    localStorage.removeItem('jwtToken');
    localStorage.removeItem('userInfo');
    // 延迟重置 flag，让当前调用栈完成后再允许下一次
    setTimeout(() => { hasHandled401 = false; }, 0);
    window.location.href = '/signin';
}

// 登录成功时调用，重置 401 处理状态
export function resetSessionExpired(): void {
    hasHandled401 = false;
}

export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('jwtToken');

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });

    // 如果 token 过期自动退出（单一权威，调用方无需再重复处理 401）
    if (res.status === 401) {
        handleSessionExpired();
    }

    return res;
};

// 统一解析后端 JSON 响应（成功/错误体均为 JSON）
export const parseJson = async (res: Response) => {
    try {
        return await res.json();
    } catch {
        return null;
    }
};

// 后端错误提示文案（无 message 时按状态码兜底）
export const errorText = (res: Response, data: { message?: string } | null): string => {
    if (data?.message) return data.message;
    if (res.status === 400) return '请求参数不符合要求';
    if (res.status === 404) return '请求的资源不存在';
    return `请求失败（${res.status}）`;
};

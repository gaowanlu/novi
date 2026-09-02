// src/api/request.ts
export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('jwtToken');

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });

    // 如果 token 过期自动退出
    if (res.status === 401) {
        localStorage.removeItem('jwtToken');
        localStorage.removeItem('userInfo');
        window.location.href = '/signin';
        // throw new Error('登录已过期');
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

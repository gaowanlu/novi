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
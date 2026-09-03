import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import AboutPage from './AboutPage'
import HomePage from './HomePage'
import SigninPage from './SigninPage'
import SignupPage from './SignupPage'
import LogoutPage from './LogoutPage'
import FunctionalPage from './FunctionalPage'
import UserInfoPage from './UserInfoPage'
import NewFriendPage from './NewFriendPage'

// 路由守卫：未登录访问受保护页面时跳转到登录页，登录成功后回跳原目标
function ProtectedRoute({ children }: { children: ReactNode }) {
    const { token, tokenVerified } = useAuth()
    const location = useLocation()

    // 刷新页面后本地 token 尚未通过服务端校验：等待校验完成，避免误跳转
    if (token && !tokenVerified) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!token) {
        return <Navigate to="/signin" replace state={{ from: location.pathname }} />
    }

    return <>{children}</>
}

function App() {
    return (
        <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/signin" element={<SigninPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/logout" element={<LogoutPage />} />
            <Route
                path="/functional"
                element={
                    <ProtectedRoute>
                        <FunctionalPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/user/info"
                element={
                    <ProtectedRoute>
                        <UserInfoPage />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/new/friend"
                element={
                    <ProtectedRoute>
                        <NewFriendPage />
                    </ProtectedRoute>
                }
            />
        </Routes>
    )
}

export default App

import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useVault } from '@/context/VaultContext'
import { VaultGate } from '@/components/VaultGate'
import AboutPage from './AboutPage'
import HomePage from './HomePage'
import SigninPage from './SigninPage'
import SignupPage from './SignupPage'
import LogoutPage from './LogoutPage'
import FunctionalPage from './FunctionalPage'
import UserInfoPage from './UserInfoPage'
import NewFriendPage from './NewFriendPage'

function ProtectedRoute({ children }: { children: ReactNode }) {
    const { token, tokenVerified } = useAuth()
    const { status, hasPassword, booting, unlock, setup } = useVault()
    const location = useLocation()

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

    // 启动引导未完成（无 vault 时的自动建箱/明文迁移均为异步）→ 加载态，
    // 避免页面在 vault 就绪前渲染、操作落空
    if (booting) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // vault 锁着且设过密码 → 必须输入密码解锁（上次设过密码的刷新场景）
    if (status === 'locked' && hasPassword) {
        return (
            <VaultGate
                mode="unlock"
                hasPassword={hasPassword}
                onUnlock={unlock}
                onSetup={setup}
            />
        )
    }

    // 从未设过密码（无 vault，或无密码 vault 被 lock 过）→ 引导设置密码（可留空）
    if (status !== 'unlocked' && !hasPassword) {
        return (
            <VaultGate
                mode="setup"
                hasPassword={hasPassword}
                onUnlock={unlock}
                onSetup={setup}
            />
        )
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

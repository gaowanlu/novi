import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './page/App.tsx'
import { AuthProvider } from './context/AuthContext';
import { VaultProvider } from './context/VaultContext';
import { Toaster } from "@/components/ui/sonner"
import ErrorBoundary from '@/components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <VaultProvider>
          <ErrorBoundary>
            <Toaster position='top-center' />
            <App />
          </ErrorBoundary>
        </VaultProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

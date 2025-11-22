import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './page/App.tsx'
import { AuthProvider } from './context/AuthContext';
import { Toaster } from "@/components/ui/sonner"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Toaster position='top-center' />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

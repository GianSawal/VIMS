import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import './index.css'
import App from './App.jsx'
import { queryClient } from './api'
import { ToastProvider } from './components/toast'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          {/* reducedMotion="user": transforms are skipped when the OS asks for reduced motion */}
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)

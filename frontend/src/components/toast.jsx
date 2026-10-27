import { createContext, useCallback, useContext, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, XCircle } from 'lucide-react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random()
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 space-y-2" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div key={t.id} layout
              initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
              {t.type === 'error'
                ? <XCircle size={18} className="text-danger" aria-hidden="true" />
                : <CheckCircle2 size={18} className="text-green-700" aria-hidden="true" />}
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

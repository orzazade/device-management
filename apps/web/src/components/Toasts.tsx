import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Kind = 'success' | 'error';
interface Toast {
  id: number;
  text: string;
  kind: Kind;
}

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Imperative escape hatch for code outside the React tree (the global
 * query error handler). ToastProvider registers itself here on mount. */
let emit: ((text: string, kind?: Kind) => void) | null = null;
const recent = new Map<string, number>();
export function toastFromAnywhere(text: string, kind: Kind = 'error') {
  const last = recent.get(text) ?? 0;
  if (Date.now() - last < 15000) return; // same message max every 15s
  recent.set(text, Date.now());
  emit?.(text, kind);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    // Errors deserve reading time; anything is dismissible by click.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  emit = push;

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            className={`toast-in flex items-center gap-2.5 rounded-xl px-4 py-2.5 font-semibold text-white shadow-lg ${
              t.kind === 'success' ? 'bg-neutral-900' : 'bg-red-700'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                t.kind === 'success' ? 'bg-green-500' : 'bg-white/25'
              }`}
            >
              {t.kind === 'success' ? '✓' : '!'}
            </span>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

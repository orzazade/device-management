import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { runRules, type Rule } from '../lib/validate';

interface FieldReg {
  validate: () => boolean;
  el: () => HTMLElement | null;
}

const Ctx = createContext<{ register: (name: string, reg: FieldReg) => () => void } | null>(
  null,
);

/** Form that validates every VField on submit; first invalid field gets
 * focus. Browser bubbles are off — our messages replace them. */
export function VForm({
  onValidSubmit,
  className,
  children,
}: {
  onValidSubmit: (f: FormData) => void;
  className?: string;
  children: ReactNode;
}) {
  const fields = useRef(new Map<string, FieldReg>());
  const register = (name: string, reg: FieldReg) => {
    fields.current.set(name, reg);
    return () => {
      fields.current.delete(name);
    };
  };
  return (
    <Ctx.Provider value={{ register }}>
      <form
        noValidate
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          let firstBad: HTMLElement | null = null;
          for (const reg of fields.current.values()) {
            if (!reg.validate() && !firstBad) firstBad = reg.el();
          }
          if (firstBad) {
            firstBad.focus();
            return;
          }
          onValidSubmit(new FormData(e.currentTarget));
        }}
      >
        {children}
      </form>
    </Ctx.Provider>
  );
}

/** Validated input/textarea with label, red border + message, live re-check
 * while typing after an error, and an optional character counter. */
export function VField({
  name,
  label,
  rules = [],
  type = 'text',
  defaultValue = '',
  placeholder,
  textarea = false,
  rows = 3,
  maxLength,
  className = '',
  autoFocus,
  autoComplete,
  inputMode,
}: {
  name: string;
  label: string;
  rules?: Rule[];
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel' | 'search' | 'decimal' | 'url';
}) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(defaultValue.length);
  const errorRef = useRef<string | null>(null);
  errorRef.current = error;
  const touched = useRef(false);
  // Always validate with the rules of the latest render, not the ones the
  // registration closed over.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  useEffect(() => {
    if (!ctx) return;
    return ctx.register(name, {
      validate: () => {
        const err = runRules(rulesRef.current, ref.current?.value ?? '');
        setError(err);
        return !err;
      },
      el: () => ref.current,
    });
  }, [name]);

  const baseCls = `w-full rounded-lg border px-3 py-2 bg-white focus:outline-none ${
    error
      ? 'border-red-400 ring-2 ring-red-100 focus:border-red-500'
      : 'border-neutral-300 focus:border-accent'
  }`;

  const shared = {
    name,
    ref: ref as never,
    defaultValue,
    placeholder,
    maxLength,
    autoFocus,
    autoComplete,
    inputMode,
    // Leaving a field you never typed in is not a mistake yet — only submit
    // (or a value you did type) may flag it. Otherwise opening a dropdown
    // next to an empty box paints it red.
    onBlur: () => {
      if (touched.current || ref.current?.value) setError(runRules(rules, ref.current?.value ?? ''));
    },
    onChange: () => {
      touched.current = true;
      if (maxLength) setCount(ref.current?.value.length ?? 0);
      if (errorRef.current) setError(runRules(rules, ref.current?.value ?? ''));
    },
  };

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-baseline justify-between text-xs font-semibold text-neutral-500">
        {label}
        {maxLength && (
          <span className={`font-normal ${count >= maxLength ? 'font-semibold text-amber-700' : count > maxLength * 0.9 ? 'text-amber-600' : 'text-neutral-400'}`}>
            {count}/{maxLength}{count >= maxLength ? ' — limit reached, extra text is cut' : ''}
          </span>
        )}
      </span>
      {textarea ? (
        <textarea rows={rows} className={baseCls} {...shared} />
      ) : (
        <input type={type} className={baseCls} {...shared} />
      )}
      {error && (
        <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-600">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-100 text-[9px]">
            !
          </span>
          {error}
        </span>
      )}
    </label>
  );
}

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Top-most modal wins Escape; parents underneath stay open. */
const stack: symbol[] = [];

/**
 * The one modal shell. Every overlay gets, for free:
 * - a portal (never inherits a host form's submit semantics)
 * - Escape closes the top-most modal only
 * - backdrop clicks do NOT discard typed work unless opted in
 * - a scroll container, so tall dialogs keep their buttons reachable
 */
export default function Modal({
  onClose,
  closeOnBackdrop = false,
  z = 'z-50',
  children,
}: {
  onClose: () => void;
  closeOnBackdrop?: boolean;
  z?: string;
  children: ReactNode;
}) {
  const id = useRef(Symbol('modal'));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const me = id.current;
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/50 p-5`}
      onClick={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      {/* items-start: a flex row would stretch the dialog to exactly 90vh and let
          taller content spill past its own background instead of scrolling. */}
      <div className="flex max-h-[90vh] w-full items-start justify-center overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body,
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { useClickOutside } from '../lib/useClickOutside';

interface NotifRow {
  id: string;
  event: string;
  text: string;
  meta: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export default function Bell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const data = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotifRow[]; unread: number }>('/notifications'),
    refetchInterval: 30000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  });

  const openItem = (n: NotifRow) => {
    if (!n.readAt) readOne.mutate(n.id);
    if (n.meta?.link) {
      setOpen(false);
      nav(n.meta.link);
    }
  };

  const unread = data.data?.unread ?? 0;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        className="relative h-9 w-9 rounded-lg border border-neutral-200 bg-white text-base shadow-sm"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10.5px] font-bold leading-4 text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-90 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3.5 py-2.5">
            <b>Notifications</b>
            {unread > 0 && (
              <button
                onClick={() => readAll.mutate()}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.data?.items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`flex w-full items-start gap-2.5 border-b border-neutral-100 px-3.5 py-2.5 text-left last:border-0 ${
                  n.meta?.link ? 'cursor-pointer hover:bg-neutral-50' : 'cursor-default'
                } ${n.readAt ? '' : 'bg-accent-soft/50'}`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.readAt ? 'bg-transparent' : 'bg-accent'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className={n.readAt ? 'text-neutral-600' : 'font-semibold'}>
                    {n.text}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                    {timeAgo(n.createdAt)} · {n.event.replace(/_/g, ' ')}
                    {n.meta?.link && <span className="text-accent">· open →</span>}
                  </span>
                </span>
              </button>
            ))}
            {(data.data?.unread ?? 0) > (data.data?.items.filter((n) => !n.readAt).length ?? 0) && (
              <p className="border-t border-neutral-100 px-4 py-2 text-center text-xs text-neutral-400">
                Older unread exist beyond the latest 30 — “Mark all as read” clears them too.
              </p>
            )}
            {data.data?.items.length === 0 && (
              <p className="p-5 text-center text-neutral-400">No notifications yet.</p>
            )}
          </div>
          {isStaff(user?.role) && (
            <div className="border-t border-neutral-100 p-2.5 text-center">
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="text-xs font-semibold text-accent"
              >
                Notification settings
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';

interface NotifRow {
  id: string;
  event: string;
  text: string;
  readAt: string | null;
  createdAt: string;
}

export default function Bell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const data = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: NotifRow[]; unread: number }>('/notifications'),
    refetchInterval: 30000,
  });

  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const toggle = () => {
    if (open && (data.data?.unread ?? 0) > 0) readAll.mutate();
    setOpen(!open);
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative h-9 w-9 rounded-lg border border-neutral-200 bg-white text-base shadow-sm"
      >
        🔔
        {(data.data?.unread ?? 0) > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10.5px] font-bold leading-4 text-white">
            {data.data!.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-85 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
          {data.data?.items.slice(0, 8).map((n) => (
            <div
              key={n.id}
              className={`border-b border-neutral-100 px-3.5 py-2.5 ${
                n.readAt ? '' : 'bg-accent-soft/60'
              }`}
            >
              {n.text}
              <div className="text-xs text-neutral-500">
                {new Date(n.createdAt).toLocaleString()} · {n.event.replace(/_/g, ' ')}
              </div>
            </div>
          ))}
          {data.data?.items.length === 0 && (
            <p className="p-5 text-center text-neutral-400">No notifications yet.</p>
          )}
          {isStaff(user?.role) && (
            <div className="p-2.5 text-center">
              <Link to="/settings" onClick={() => setOpen(false)} className="text-accent">
                Notification settings
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

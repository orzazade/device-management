import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import LoadFailed from '../components/LoadFailed';
import ChangeDiff from '../components/ChangeDiff';
import { api } from '../lib/api';

interface AuditRow {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  entityLabel?: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

const ENTITY_TYPES = ['device', 'request', 'user', 'project', 'repair', 'email', 'setting', 'notification_rule'];
const PAGE = 100;

export default function Audit() {
  // Filters live in the URL, so a filtered view is shareable.
  const [params, setParams] = useSearchParams();
  const entityType = params.get('entity') ?? '';
  const actor = params.get('actor') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const query = new URLSearchParams();
  if (entityType) query.set('entityType', entityType);
  if (actor) query.set('actor', actor);
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const pages = useInfiniteQuery({
    queryKey: ['audit', entityType, actor, from, to],
    queryFn: ({ pageParam }) =>
      api<AuditRow[]>(
        `/audit?limit=${PAGE}&${query}${pageParam ? `&beforeId=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = {
    data: pages.data?.pages.flat(),
    isLoading: pages.isLoading,
    isError: pages.isError,
    refetch: pages.refetch,
  };
  const filterCls =
    'rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none';
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Audit log</h1>
        <span className="text-neutral-500">Append-only. Who, what, old → new.</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={entityType}
          onChange={(e) => setFilter('entity', e.target.value)}
          className={filterCls}
        >
          <option value="">All entities</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={actor}
          onChange={(e) => setFilter('actor', e.target.value)}
          placeholder="Who…"
          className={`${filterCls} w-36`}
        />
        <input type="date" value={from} onChange={(e) => setFilter('from', e.target.value)} className={filterCls} />
        <span className="text-neutral-400">–</span>
        <input type="date" value={to} onChange={(e) => setFilter('to', e.target.value)} className={filterCls} />
        {(entityType || actor || from || to) && (
          <button
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="text-sm font-semibold text-accent"
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">What</th>
              <th className="px-4 py-2.5">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0 align-top">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">{r.actorName}</td>
                <td className="px-4 py-2.5">
                  <span className="capitalize">{r.entityType.replace(/_/g, ' ')}</span>{' '}
                  <span className="font-semibold">{r.action.replace(/_/g, ' ')}</span>
                  {r.entityLabel && (
                    <span className="block text-xs text-neutral-500">{r.entityLabel}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <ChangeDiff oldValue={r.oldValue} newValue={r.newValue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.isLoading && <p className="p-6 text-neutral-400">loading…</p>}
        {rows.isError && <div className="p-4"><LoadFailed what="the audit log" onRetry={() => rows.refetch()} /></div>}
        {rows.data?.length === 0 && <p className="p-6 text-neutral-400">Nothing matches these filters.</p>}
      </div>
      {pages.hasNextPage && (
        <div className="mt-3 text-center">
          <button
            onClick={() => pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            {pages.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
          </button>
        </div>
      )}
    </div>
  );
}

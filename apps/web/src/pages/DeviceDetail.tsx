import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/Modal';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ChangeDiff from '../components/ChangeDiff';
import LoadFailed from '../components/LoadFailed';
import { VForm, VField } from '../components/VForm';
import { minLen, required } from '../lib/validate';
import { SPEC_FIELDS, SPEC_SECTIONS } from '../lib/specs';
import Chip from '../components/Chip';
import DeviceEditModal from '../components/DeviceEditModal';
import RequestModal from '../components/RequestModal';
import { isStaff, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { AuditRow, DeviceRow } from '../lib/types';

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'specs' | 'history' | 'repairs'>('specs');
  const [showRequest, setShowRequest] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const { user } = useAuth();
  const device = useQuery({
    queryKey: ['device', id],
    queryFn: () => api<DeviceRow>(`/devices/${id}`),
  });
  const bookings = useQuery({
    queryKey: ['device-bookings', id],
    queryFn: () =>
      api<{ fromDate: string; toDate: string; kind: 'booked' | 'requested' }[]>(
        `/devices/${id}/bookings`,
      ),
  });
  const qc = useQueryClient();
  const toast = useToast();
  const [showDamage, setShowDamage] = useState(false);
  const [damageError, setDamageError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['device-history', id],
    queryFn: () => api<AuditRow[]>(`/devices/${id}/history`),
    enabled: tab === 'history',
  });
  interface RepairTabRow {
    id: string;
    issue: string;
    state: string;
    reportedBy?: string;
    createdAt: string;
  }
  const repairs = useQuery({
    queryKey: ['device-repairs', id],
    queryFn: () => api<RepairTabRow[]>(`/devices/${id}/repairs`),
    enabled: tab === 'repairs',
  });
  const report = useMutation({
    mutationFn: (issue: string) =>
      api('/repairs', { method: 'POST', body: { deviceId: id, issue } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', id] });
      qc.invalidateQueries({ queryKey: ['device-repairs', id] });
      setShowDamage(false);
      setDamageError(null);
      toast('Damage reported');
    },
    onError: (e) => setDamageError(e.message),
  });

  const d = device.data;
  if (device.isLoading) return <p className="text-neutral-400">loading…</p>;
  if (!d) return <p className="text-neutral-400">Device not found.</p>;

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`border-b-2 px-3 py-2.5 font-semibold ${
        tab === key ? 'border-accent text-accent' : 'border-transparent text-neutral-500'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/devices" className="text-accent no-underline">
          ←
        </Link>
        <h1 className="text-xl font-bold">
          {d.brand} {d.model}
        </h1>
        <Chip status={d.status} />
        <div className="flex-1" />
        {(d.status === 'available' || d.status === 'assigned') && (
          <button
            onClick={() => setShowRequest(true)}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
          >
            Request this device
          </button>
        )}
        {d.status !== 'retired' && (
          <button
            onClick={() => setShowDamage(true)}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-semibold text-red-700"
          >
            Report damage
          </button>
        )}
        {isStaff(user?.role) && (
          <button
            onClick={() => setShowEdit(true)}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-semibold"
          >
            Edit
          </button>
        )}
      </div>
      {showRequest && <RequestModal device={d} onClose={() => setShowRequest(false)} />}
      {showEdit && <DeviceEditModal device={d} onClose={() => setShowEdit(false)} />}

      {(d.holder || (bookings.data?.length ?? 0) > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm shadow-sm">
          <span className="font-semibold text-neutral-500">Availability</span>
          {d.holder && (
            <span>
              Held by <b>{d.holder.name}</b>
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const current = bookings.data?.find(
                  (b) => b.kind === 'booked' && b.fromDate <= today,
                );
                return current ? <> until <b>{current.toDate}</b></> : null;
              })()}
            </span>
          )}
          {bookings.data
            ?.filter((b) => b.kind === 'booked' && b.fromDate > new Date().toISOString().slice(0, 10))
            .slice(0, 3)
            .map((b) => (
              <span key={b.fromDate} className="text-neutral-500">
                booked {b.fromDate} – {b.toDate}
              </span>
            ))}
          {bookings.data?.some((b) => b.kind === 'requested') && (
            <span className="text-amber-700">+ pending requests</span>
          )}
        </div>
      )}

      {d.damageNote && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
          🛠 Known damage: <b>{d.damageNote}</b>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex gap-1 border-b border-neutral-200 px-4">
          {tabBtn('specs', 'Specs')}
          {tabBtn('history', 'History')}
          {tabBtn('repairs', 'Repairs')}
        </div>

        {tab === 'specs' && (
          <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 p-4">
            <dt className="text-neutral-500">OS</dt>
            <dd>
              {d.os} {d.osVersion}
            </dd>
            <dt className="text-neutral-500">Serial</dt>
            <dd className="font-mono text-xs">{d.serial}</dd>
            <dt className="text-neutral-500">IMEI</dt>
            <dd className="font-mono text-xs">{d.imei || '—'}</dd>
            <dt className="text-neutral-500">Current holder</dt>
            <dd>{d.holder?.name ?? '— (lab desk)'}</dd>
            <dt className="text-neutral-500">Project</dt>
            <dd>{d.project?.name ?? '—'}</dd>
            <dt className="text-neutral-500">Accessories</dt>
            <dd>{d.accessories.length ? d.accessories.join(' · ') : 'none'}</dd>
          </dl>
        )}
        {tab === 'specs' && (
          <div className="border-t border-neutral-100 p-4 pt-3">
            {SPEC_SECTIONS.map((section) => {
              const filled = SPEC_FIELDS.filter(
                (def) => def.section === section && d.specs?.[def.key] != null,
              );
              if (!filled.length) return null;
              return (
                <div key={section} className="mb-3 last:mb-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    {section}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {filled.map((def) =>
                      def.type === 'bool' ? (
                        <span
                          key={def.key}
                          className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800"
                        >
                          ✓ {def.label}
                        </span>
                      ) : (
                        <span
                          key={def.key}
                          className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs"
                        >
                          <span className="text-neutral-500">{def.label}:</span>{' '}
                          <b>{String(d.specs[def.key])}</b>
                        </span>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
            {!SPEC_FIELDS.some((def) => d.specs?.[def.key] != null) && (
              <p className="text-neutral-400">
                No specs recorded yet — add them via Edit so testers can find this device.
              </p>
            )}
          </div>
        )}

        {tab === 'history' &&
          (history.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-4 py-2.5">Who</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((a) => (
                    <tr key={a.id} className="border-b border-neutral-100 align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">{a.actorName}</td>
                      <td className="px-4 py-2.5">{a.action.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5">
                        <ChangeDiff oldValue={a.oldValue} newValue={a.newValue} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : history.isError ? (
            <div className="p-4"><LoadFailed what="history" onRetry={() => history.refetch()} /></div>
          ) : (
            <p className="p-6 text-neutral-400">
              {history.isLoading ? 'loading…' : 'No history yet.'}
            </p>
          ))}

        {tab === 'repairs' &&
          (repairs.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-2.5">Opened</th>
                    <th className="px-4 py-2.5">Issue</th>
                    <th className="px-4 py-2.5">By</th>
                    <th className="px-4 py-2.5">State</th>
                  </tr>
                </thead>
                <tbody>
                  {repairs.data.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5">{r.issue}</td>
                      <td className="px-4 py-2.5">{r.reportedBy ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <Chip status={r.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : repairs.isError ? (
            <div className="p-4"><LoadFailed what="repairs" onRetry={() => repairs.refetch()} /></div>
          ) : (
            <p className="p-6 text-neutral-400">
              {repairs.isLoading ? 'loading…' : 'No repairs. Long may it last.'}
            </p>
          ))}
      </div>

      {showDamage && (
        <Modal onClose={() => setShowDamage(false)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) => report.mutate(String(f.get('issue')))}
          >
            <h2 className="mb-4 text-lg font-bold">
              Report damage — {d.brand} {d.model}
            </h2>
            <div className="mb-3">
              <VField
                name="issue"
                label="What happened?"
                textarea
                rows={3}
                maxLength={300}
                autoFocus
                placeholder="Describe the damage"
                rules={[required('Describe the damage'), minLen(5)]}
              />
            </div>
            {damageError && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{damageError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDamage(false)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={report.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Report
              </button>
            </div>
          </VForm>
        </Modal>
      )}
    </div>
  );
}

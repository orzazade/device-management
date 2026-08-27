import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/Modal';
import LoadFailed from '../components/LoadFailed';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Chip from '../components/Chip';
import ImportModal from '../components/ImportModal';
import RequestModal from '../components/RequestModal';
import SpecFields from '../components/SpecFields';
import { collectSpecs, specsToPairs } from '../lib/specs';
import { VForm, VField } from '../components/VForm';
import { imei, required, serial } from '../lib/validate';
import { useToast } from '../components/Toasts';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { DeviceRow, ProjectRow } from '../lib/types';

const isFlag = (v: string) => /^(yes|no|true|false)$/i.test(v);

export default function Devices() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [urlParams, setUrlParams] = useSearchParams();
  const [q, setQ] = useState(urlParams.get('q') ?? '');
  // The header's global search lands here as ?q=… — keep the box in sync.
  useEffect(() => setQ(urlParams.get('q') ?? ''), [urlParams]);
  const [brand, setBrand] = useState(urlParams.get('brand') ?? '');
  const [os, setOs] = useState(urlParams.get('os') ?? '');
  const [status, setStatus] = useState(urlParams.get('status') ?? '');
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [requestFor, setRequestFor] = useState<DeviceRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams();
  // Filters mirror into the URL so back-from-a-device keeps them.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (brand) next.set('brand', brand);
    if (os) next.set('os', os);
    if (status) next.set('status', status);
    if (next.toString() !== urlParams.toString()) setUrlParams(next, { replace: true });
  }, [q, brand, os, status]);
  // Debounced search: one request ~250ms after typing stops, and the
  // previous rows stay on screen while the next result loads.
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (dq) params.set('q', dq);
  if (brand) params.set('brand', brand);
  if (os) params.set('os', os);
  if (status) params.set('status', status);
  const devices = useQuery({
    queryKey: ['devices', dq, brand, os, status],
    queryFn: () => api<DeviceRow[]>(`/devices?${params}`),
    placeholderData: keepPreviousData,
  });
  const all = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceRow[]>('/devices') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectRow[]>('/projects') });

  const brands = useMemo(() => [...new Set(all.data?.map((d) => d.brand) ?? [])].sort(), [all.data]);
  const oses = useMemo(() => [...new Set(all.data?.map((d) => d.os) ?? [])].sort(), [all.data]);

  const restore = useMutation({
    mutationFn: (id: string) => api(`/devices/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast('Device restored');
    },
    onError: (e) => setError(e.message),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/devices', { method: 'POST', body }),
    onSuccess: (_d, body) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      setShowCreate(false);
      setError(null);
      toast(`Device "${body.brand} ${body.model}" added`);
    },
    onError: (e) => setError(e.message),
  });

  const selCls = 'rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Devices</h1>
        <span className="text-neutral-500">
          {status === 'deleted'
            ? `${devices.data?.length ?? '…'} deleted`
            : `${devices.data?.length ?? '…'} of ${all.data?.length ?? '…'}`}
        </span>
        <div className="flex-1" />
        {isStaff(user?.role) && (
          <>
            <button data-testid="device-import"
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-semibold"
            >
              Import Excel
            </button>
            <button data-testid="device-add"
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
            >
              Add device
            </button>
          </>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search brand, model, OS, serial, holder…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-72 rounded-lg border border-neutral-300 bg-white px-3 py-1.5"
        />
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selCls}>
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select value={os} onChange={(e) => setOs(e.target.value)} className={selCls}>
          <option value="">All OS</option>
          {oses.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="">Any status</option>
          <option value="available">Available</option>
          <option value="assigned">Assigned</option>
          <option value="in_repair">In repair</option>
          <option value="retired">Retired</option>
          {isStaff(user?.role) && <option value="deleted">Deleted 🗑</option>}
        </select>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">OS</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Holder</th>
              <th className="px-4 py-2.5">Project</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {devices.data?.map((d) => (
              <tr
                key={d.id}
                data-testid="device-row"
                data-status={d.status}
                onClick={() => status !== 'deleted' && nav(`/devices/${d.id}`)}
                className={`border-b border-neutral-100 last:border-0 ${
                  status === 'deleted' ? 'opacity-60' : 'cursor-pointer hover:bg-neutral-50'
                }`}
              >
                <td className="px-4 py-2.5">
                  <b>
                    {d.brand} {d.model}
                  </b>
                  {d.damageNote && <span title={d.damageNote}> 🛠</span>}
                  <br />
                  <span className="font-mono text-xs text-neutral-500">{d.serial}</span>
                  {specsToPairs(d.specs).length > 0 && (
                    <span className="block text-xs text-neutral-500">
                      {[...specsToPairs(d.specs)]
                        // Real values (8 GB) tell more at a glance than yes/no flags.
                        .sort((a, b) => Number(isFlag(a.value)) - Number(isFlag(b.value)))
                        .slice(0, 3)
                        .map((p) => (p.value ? `${p.key} ${p.value}` : p.key))
                        .join(' · ')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {d.os} {d.osVersion}
                </td>
                <td className="px-4 py-2.5">
                  {status === 'deleted' ? (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                      Deleted
                    </span>
                  ) : (
                    <Chip status={d.status} />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {d.holder?.name ?? '—'}
                  {d.busy && (
                    <span className="block text-xs text-neutral-500">
                      free from {d.busy.until}{d.busy.state === 'overdue' ? ' (overdue)' : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">{d.project?.name ?? '—'}</td>
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  {status === 'deleted' ? (
                    <button
                      onClick={() => restore.mutate(d.id)}
                      disabled={restore.isPending}
                      className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      Restore
                    </button>
                  ) : (
                    (d.status === 'available' || d.status === 'assigned') && (
                      <button data-testid="device-request"
                        onClick={() => setRequestFor(d)}
                        className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white"
                      >
                        Request
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {devices.isLoading && <p className="p-6 text-neutral-400">loading…</p>}
        {devices.isError && (
          <div className="p-4"><LoadFailed what="devices" onRetry={() => devices.refetch()} /></div>
        )}
        {!devices.isError && devices.data?.length === 0 && (
          <p className="p-6 text-neutral-400">No devices match. Clear a filter?</p>
        )}
      </div>

      {requestFor && <RequestModal device={requestFor} onClose={() => setRequestFor(null)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <VForm
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
            onValidSubmit={(f) => {
              create.mutate({
                brand: f.get('brand'),
                model: f.get('model'),
                os: f.get('os'),
                osVersion: f.get('osVersion') || undefined,
                specs: collectSpecs(f),
                serial: f.get('serial'),
                imei: f.get('imei') || undefined,
                accessories: String(f.get('accessories') || '')
                  .split(',')
                  .map((a) => a.trim())
                  .filter(Boolean),
                projectId: f.get('projectId') || undefined,
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Add device</h2>
            <div className="grid grid-cols-2 gap-3">
              <VField name="brand" label="Brand *" autoFocus placeholder="Samsung"
                rules={[required('Brand is required')]} />
              <VField name="model" label="Model *" placeholder="Galaxy S24"
                rules={[required('Model is required')]} />
              <VField name="os" label="OS *" placeholder="Android"
                rules={[required('OS is required')]} />
              <VField name="osVersion" label="OS version" placeholder="14" />
              <VField name="serial" label="Serial *" placeholder="RF8T2001"
                autoComplete="off" rules={[required('Serial is required'), serial()]} />
              <VField name="imei" label="IMEI" placeholder="353912100000001"
                autoComplete="off" inputMode="numeric" rules={[imei()]} />
            </div>
            <SpecFields />
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">
                Accessories (comma-separated)
              </span>
              <input
                name="accessories"
                placeholder="Box, Cable, Charger"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Project</span>
              <select name="projectId" className="w-full rounded-lg border border-neutral-300 px-3 py-2">
                <option value="">— none —</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={create.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </VForm>
        </Modal>
      )}
    </div>
  );
}

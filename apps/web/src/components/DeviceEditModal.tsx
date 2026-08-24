import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { collectSpecs } from '../lib/specs';
import { imei, required } from '../lib/validate';
import { VForm, VField } from './VForm';
import type { DeviceRow, ProjectRow } from '../lib/types';
import SpecFields from './SpecFields';
import ConfirmModal from './ConfirmModal';
import { useToast } from './Toasts';

export default function DeviceEditModal({
  device,
  onClose,
}: {
  device: DeviceRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectRow[]>('/projects'),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/devices/${device.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', device.id] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['device-history', device.id] });
      toast('Device saved');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api(`/devices/${device.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast('Device deleted — restorable from the Deleted view');
      onClose();
      nav('/devices');
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(e.message);
    },
  });

  const field = (name: string, label: string, value: string, required = false) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-neutral-500">{label}</span>
      <input
        name={name}
        defaultValue={value}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2"
      />
    </label>
  );

  return (
    <Modal onClose={() => onClose()}>
      <VForm
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onValidSubmit={(f) => {
          save.mutate({
            brand: f.get('brand'),
            model: f.get('model'),
            os: f.get('os'),
            osVersion: f.get('osVersion') || '',
            specs: collectSpecs(f),
            imei: f.get('imei') || '',
            accessories: String(f.get('accessories') || '')
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean),
            projectId: f.get('projectId') || null,
          });
        }}
      >
        <h2 className="mb-1 text-lg font-bold">
          Edit {device.brand} {device.model}
        </h2>
        <p className="mb-4 text-neutral-500">
          Serial <span className="font-mono text-xs">{device.serial}</span> stays fixed — it
          identifies the physical device. Every change lands in the audit log.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <VField name="brand" label="Brand *" defaultValue={device.brand}
            rules={[required('Brand is required')]} />
          <VField name="model" label="Model *" defaultValue={device.model}
            rules={[required('Model is required')]} />
          <VField name="os" label="OS *" defaultValue={device.os}
            rules={[required('OS is required')]} />
          <VField name="osVersion" label="OS version" defaultValue={device.osVersion} />
          <VField name="imei" label="IMEI" defaultValue={device.imei} rules={[imei()]} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">Project</span>
            <select
              name="projectId"
              defaultValue={device.project?.id ?? ''}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            >
              <option value="">— none —</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SpecFields specs={device.specs} />
        <div className="mt-3">
          {field('accessories', 'Accessories (comma-separated)', device.accessories.join(', '))}
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
          >
            Delete…
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={save.isPending}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
        {confirmDelete && (
          <ConfirmModal
            title={`Delete ${device.brand} ${device.model}?`}
            body="The device disappears from all lists but its history stays. A Manager or Admin can restore it from the Deleted view anytime."
            busy={remove.isPending}
            onConfirm={() => remove.mutate()}
            onClose={() => setConfirmDelete(false)}
          />
        )}
      </VForm>
    </Modal>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { useRef, useState, type DragEvent } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toasts';

interface Report {
  ok: number;
  errors: { row: number; message: string }[];
  committed: boolean;
}

type Phase = 'pick' | 'checking' | 'report' | 'importing' | 'done';

const prettySize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>('pick');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const takeFile = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError(`"${f.name}" is not an .xlsx file`);
      return;
    }
    setFile(f);
    setReport(null);
    setPhase('pick');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    takeFile(e.dataTransfer.files?.[0]);
  };

  const run = async (commit: boolean) => {
    if (!file) return;
    setPhase(commit ? 'importing' : 'checking');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<Report>(`/devices/import?commit=${commit}`, { formData: fd });
      setReport(r);
      if (r.committed) {
        setPhase('done');
        qc.invalidateQueries({ queryKey: ['devices'] });
        toast(`Imported ${r.ok} devices${r.errors.length ? `, ${r.errors.length} rows rejected` : ''}`);
      } else {
        setPhase('report');
      }
    } catch (e) {
      setPhase(file ? 'report' : 'pick');
      setError(e instanceof Error ? e.message : 'Upload failed');
      toast('Import failed — see the details in the dialog', 'error');
    }
  };

  const spinner = (label: string) => (
    <div className="flex flex-col items-center gap-3 py-10">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-neutral-200 border-t-accent" />
      <p className="font-semibold">{label}</p>
      <p className="text-neutral-500">{file?.name}</p>
    </div>
  );

  return (
    <Modal onClose={() => onClose()}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6">
        <h2 className="mb-1 text-lg font-bold">Import devices from Excel</h2>
        <p className="mb-4 text-neutral-500">
          Columns:{' '}
          <code className="font-mono text-xs">
            brand, model, os, os_version, specs, serial, imei, accessories, project
          </code>
          . Nothing is saved until you confirm the check report.
        </p>

        {phase === 'checking' && spinner('Checking the file…')}
        {phase === 'importing' && spinner('Importing devices…')}

        {(phase === 'pick' || phase === 'report') && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-7 text-center transition-colors ${
                drag
                  ? 'border-accent bg-accent-soft'
                  : 'border-neutral-300 bg-neutral-50 hover:border-accent/60'
              }`}
            >
              <div className="mb-2 text-3xl">📄</div>
              {file ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-sm">
                  <b>{file.name}</b>
                  <span className="text-neutral-500">{prettySize(file.size)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setReport(null);
                      setPhase('pick');
                    }}
                    className="ml-1 font-bold text-neutral-400 hover:text-red-600"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-semibold">
                    Drop your .xlsx here — or <span className="text-accent">browse</span>
                  </p>
                  <p className="text-neutral-500">Max 10 MB</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e) => takeFile(e.target.files?.[0])}
              />
            </div>

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700">
                {error}
              </p>
            )}

            {report && phase === 'report' && (
              <div className="mt-4">
                <p className="mb-2">
                  <span className="mr-2 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                    ✓ {report.ok} rows OK
                  </span>
                  {report.errors.length > 0 && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                      ✗ {report.errors.length} rows broken
                    </span>
                  )}
                </p>
                {report.errors.length > 0 && (
                  <div className="mb-2 overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                          <th className="px-3 py-2">Row</th>
                          <th className="px-3 py-2">Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.errors.map((e) => (
                          <tr key={e.row} className="border-b border-neutral-100 last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">{e.row}</td>
                            <td className="px-3 py-2">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-neutral-500">
                  Nothing is saved yet. Import the {report.ok} valid rows, or fix the file and
                  drop it again.
                </p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              {phase === 'pick' && (
                <button
                  disabled={!file}
                  onClick={() => run(false)}
                  className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  Run check
                </button>
              )}
              {phase === 'report' && report && (
                <button
                  disabled={report.ok === 0}
                  onClick={() => run(true)}
                  className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  Import {report.ok} valid rows
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'done' && report && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700">
              ✓
            </div>
            <p className="mb-1 text-lg font-bold">Imported {report.ok} devices</p>
            {report.errors.length > 0 && (
              <p className="text-neutral-500">
                {report.errors.length} broken rows were rejected (rows{' '}
                {report.errors.map((e) => e.row).join(', ')}).
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-5 rounded-lg bg-accent px-5 py-2 font-semibold text-white"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

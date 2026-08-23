import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';

interface Report {
  ok: number;
  errors: { row: number; message: string }[];
  committed: boolean;
}

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (commit: boolean) => {
      const fd = new FormData();
      fd.append('file', file!);
      return api<Report>(`/devices/import?commit=${commit}`, { formData: fd });
    },
    onSuccess: (r) => {
      setReport(r);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Excel import</h1>
      <div className="max-w-2xl rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="mb-4">
          Columns: <code className="font-mono text-xs">brand, model, os, os_version, specs, serial, imei, accessories, project</code>
          . The file is checked first — nothing is saved until you confirm the report.
        </p>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setReport(null);
          }}
          className="mb-4 block w-full rounded-lg border border-neutral-300 p-2"
        />
        <button
          disabled={!file || run.isPending}
          onClick={() => run.mutate(false)}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Run dry-run check
        </button>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

        {report && (
          <div className="mt-5">
            <p className="mb-2">
              <span className="mr-2 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                {report.ok} rows OK
              </span>
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                {report.errors.length} rows broken
              </span>
            </p>
            {report.errors.length > 0 && (
              <table className="mb-3 w-full border-collapse rounded-lg border border-neutral-200">
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
            )}
            {report.committed ? (
              <p className="font-semibold text-green-800">
                ✅ Imported {report.ok} devices. {report.errors.length} rows rejected (listed above).
              </p>
            ) : (
              <>
                <p className="mb-3 text-neutral-500">
                  Nothing is saved yet. Import the {report.ok} valid rows, or fix the file and retry.
                </p>
                <button
                  disabled={report.ok === 0 || run.isPending}
                  onClick={() => run.mutate(true)}
                  className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  Import {report.ok} valid rows
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, [string, string]> = {
  available: ['Available', 'bg-green-100 text-green-800'],
  assigned: ['Assigned', 'bg-accent-soft text-accent'],
  in_repair: ['In repair', 'bg-amber-100 text-amber-800'],
  retired: ['Retired', 'bg-neutral-200 text-neutral-600'],
  pending: ['Pending', 'bg-amber-100 text-amber-800'],
  approved: ['Awaiting handover', 'bg-accent-soft text-accent'],
  active: ['Active', 'bg-green-100 text-green-800'],
  rejected: ['Rejected', 'bg-neutral-200 text-neutral-600'],
  returned: ['Returned', 'bg-neutral-200 text-neutral-600'],
  overdue: ['Overdue', 'bg-red-100 text-red-800'],
  cancelled: ['Cancelled', 'bg-neutral-200 text-neutral-600'],
  reported: ['Reported', 'bg-amber-100 text-amber-800'],
  repair_requested: ['Repair requested', 'bg-amber-100 text-amber-800'],
  fixed: ['Fixed', 'bg-green-100 text-green-800'],
  written_off: ['Written off', 'bg-neutral-200 text-neutral-600'],
};

export default function Chip({ status }: { status: string }) {
  const [label, cls] = styles[status] ?? [status, 'bg-neutral-200 text-neutral-600'];
  return (
    <span
      data-testid="chip"
      data-status={status}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

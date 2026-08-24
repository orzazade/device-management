import { useMemo, useState } from 'react';

export interface BookingRange {
  fromDate: string;
  toDate: string;
  kind: 'booked' | 'requested';
}

export interface DateRange {
  from: string | null;
  to: string | null;
}

const DAY = 86400000;
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
const todayIso = () => fmt(new Date());

/**
 * Range picker that makes conflicts unpickable: booked days are disabled
 * ("Booked" on hover), pending ones too ("Requested"), past days are gone,
 * and a selection can never stretch across a taken day.
 */
export default function RangeCalendar({
  bookings,
  value,
  onChange,
}: {
  bookings: BookingRange[];
  value: DateRange;
  onChange: (v: DateRange) => void;
}) {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [hint, setHint] = useState<string | null>(null);

  const kindOf = useMemo(() => {
    return (iso: string): 'booked' | 'requested' | null => {
      for (const b of bookings) {
        if (iso >= b.fromDate && iso <= b.toDate) {
          if (b.kind === 'booked') return 'booked';
        }
      }
      for (const b of bookings) {
        if (iso >= b.fromDate && iso <= b.toDate && b.kind === 'requested') return 'requested';
      }
      return null;
    };
  }, [bookings]);

  const spanScan = (a: string, b: string) => {
    let booked = 0;
    let requested = 0;
    for (
      let t = new Date(a + 'T12:00:00').getTime();
      t <= new Date(b + 'T12:00:00').getTime();
      t += DAY
    ) {
      const k = kindOf(fmt(new Date(t)));
      if (k === 'booked') booked++;
      if (k === 'requested') requested++;
    }
    return { booked, requested };
  };

  const pick = (iso: string) => {
    setHint(null);
    if (!value.from || (value.from && value.to)) {
      onChange({ from: iso, to: null });
      return;
    }
    if (iso < value.from) {
      onChange({ from: iso, to: null });
      return;
    }
    const scan = spanScan(value.from, iso);
    if (scan.booked > 0) {
      setHint('That range crosses a booked day — pick a free gap.');
      onChange({ from: iso, to: null });
      return;
    }
    if (scan.requested > 0) {
      // Pending requests don't own the calendar — warn, don't block.
      setHint(
        `⚠ ${scan.requested} of these days ${scan.requested === 1 ? 'is' : 'are'} also requested by someone else — the approver decides who gets them.`,
      );
    }
    onChange({ from: value.from, to: iso });
  };

  const cells = useMemo(() => {
    const first = new Date(month);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first.getTime() - startOffset * DAY);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY);
      return { d, iso: fmt(d), inMonth: d.getMonth() === month.getMonth() };
    });
  }, [month]);

  const today = todayIso();
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="h-7 w-7 rounded-lg border border-neutral-200 font-bold"
        >
          ‹
        </button>
        <b>{monthLabel}</b>
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="h-7 w-7 rounded-lg border border-neutral-200 font-bold"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => (
          <div key={w} className="py-1 text-[10.5px] font-semibold uppercase text-neutral-400">
            {w}
          </div>
        ))}
        {cells.map(({ iso, d, inMonth }) => {
          const kind = kindOf(iso);
          const past = iso < today;
          const disabled = past || kind === 'booked';
          const inRange =
            value.from &&
            ((value.to && iso >= value.from && iso <= value.to) || iso === value.from);
          const title = kind === 'booked' ? 'Booked' : kind === 'requested' ? 'Requested by someone else — still pickable' : past ? 'Past' : '';
          let cls = 'text-neutral-900 hover:bg-accent-soft';
          if (!inMonth) cls = 'text-neutral-300 hover:bg-accent-soft';
          if (kind === 'booked') cls = 'bg-red-100 text-red-400 line-through cursor-not-allowed';
          if (kind === 'requested') cls = 'bg-amber-100 text-amber-700 hover:bg-amber-200';
          if (past && !kind) cls = 'text-neutral-300 cursor-not-allowed';
          if (inRange) cls = 'bg-accent text-white font-bold';
          return (
            <button
              type="button"
              key={iso}
              title={title}
              disabled={disabled}
              onClick={() => pick(iso)}
              className={`h-8 rounded-lg text-sm tabular-nums ${cls}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-100 outline outline-1 outline-red-200" /> Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-100 outline outline-1 outline-amber-200" /> Requested
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Your pick
        </span>
      </div>
      <p className="mt-2 min-h-4 text-sm">
        {hint ? (
          <span className={hint.startsWith('⚠') ? 'text-amber-700' : 'text-red-700'}>{hint}</span>
        ) : value.from && value.to ? (
          <>
            Selected: <b>{value.from}</b> → <b>{value.to}</b>
          </>
        ) : value.from ? (
          <>
            From <b>{value.from}</b> — now pick the end date
          </>
        ) : (
          'Pick a start date'
        )}
      </p>
    </div>
  );
}

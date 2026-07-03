import { formatDateDivider } from '../lib/messageDates';

type DateDividerProps = {
  timestamp: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};

export default function DateDivider({ timestamp, t, formatDate }: DateDividerProps) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-black/20 px-3 py-1 text-[11px] text-white">
        {formatDateDivider(timestamp, t, formatDate)}
      </span>
    </div>
  );
}

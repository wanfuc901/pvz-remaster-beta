import { useEffect, useState } from 'react';
import { useOs } from '../os/store';

const DAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align ticks to the interval boundary so the minute flips on time.
    let timer: number;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    };
    timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    return () => clearTimeout(timer);
  }, [intervalMs]);
  return now;
}

export function formatTime(d: Date, h24: boolean, seconds: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  let h = d.getHours();
  let suffix = '';
  if (!h24) {
    suffix = h >= 12 ? ' CH' : ' SA';
    h = h % 12 || 12;
  }
  return `${h24 ? pad(h) : h}:${pad(d.getMinutes())}${seconds ? ':' + pad(d.getSeconds()) : ''}${suffix}`;
}

export function formatLongDate(d: Date): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

export function ClockText({ className }: { className?: string }) {
  const h24 = useOs((s) => s.settings.clock24h);
  const sec = useOs((s) => s.settings.showSeconds);
  const now = useNow(sec ? 1000 : 60_000);
  return <span className={className}>{formatTime(now, h24, sec)}</span>;
}

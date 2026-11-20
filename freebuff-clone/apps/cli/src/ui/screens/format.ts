/** Shared duration formatting for the CLI screens; DST-safe by construction. */
const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatClock = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
};

export const formatHours = (seconds: number): string => (seconds / 3600).toFixed(2);

/** Human remaining time until an absolute reset timestamp. */
export const formatRemaining = (resetsAt: string, now: Date): string => {
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) {
    return "unknown";
  }
  const remaining = Math.max(0, Math.floor((target - now.getTime()) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours === 0 && minutes === 0) {
    return "under a minute";
  }
  if (hours === 0) {
    return `${String(minutes)}m`;
  }
  return `${String(hours)}h ${String(minutes)}m`;
};

/**
 * What needs attention.
 *
 * Sorted by severity so the worst thing is always the top line. Renders nothing at all
 * when the colony is fine — an empty panel taking up space trains the player to ignore
 * the whole corner of the screen.
 */

import type { Alert, AlertLevel } from '../sim/alerts';

const ORDER: Record<AlertLevel, number> = { danger: 0, warning: 1, info: 2 };

export function AlertsPanel({ alerts }: { readonly alerts: readonly Alert[] }) {
  if (alerts.length === 0) return null;

  const sorted = [...alerts].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  return (
    <aside className="alerts">
      {sorted.map((alert) => (
        <div key={alert.id} className={`alert alert--${alert.level}`}>
          {alert.text}
        </div>
      ))}
    </aside>
  );
}

'use client';

import { useState, useEffect } from 'react';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/audit-logs')
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const formatAction = (action: string) => {
    const parts = action.split('.');
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  const getActionColor = (action: string) => {
    if (action.includes('created')) return 'text-green-600 dark:text-green-400';
    if (action.includes('accepted')) return 'text-blue-600 dark:text-blue-400';
    if (action.includes('started')) return 'text-blue-600 dark:text-blue-400';
    if (action.includes('completed')) return 'text-green-600 dark:text-green-400';
    if (action.includes('cancelled')) return 'text-red-600 dark:text-red-400';
    if (action.includes('sos')) return 'text-red-600 dark:text-red-400';
    if (action.includes('rating')) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-[var(--muted)]';
  };

  if (loading) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
        <p className="text-sm text-[var(--muted)]">Loading audit log...</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Activity Log</h3>
      </div>
      {logs.length > 0 ? (
        <div className="divide-y divide-[var(--border)]">
          {logs.map((log) => (
            <div key={log.id} className="px-4 py-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${getActionColor(log.action)}`}>
                    {formatAction(log.action)}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {log.entity}
                  </span>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
              {expanded === log.id && log.details && (
                <pre className="mt-2 text-xs text-[var(--muted)] bg-[var(--background)] rounded p-2 overflow-x-auto">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-center">
          <p className="text-sm text-[var(--muted)]">No activity recorded yet.</p>
        </div>
      )}
    </div>
  );
}

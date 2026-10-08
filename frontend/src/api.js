const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function handle(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchWorkflows() {
  const res = await fetch(`${API_BASE}/workflows`);
  return handle(res);
}

export async function syncWorkflows() {
  const res = await fetch(`${API_BASE}/workflows/sync`, { method: 'POST' });
  return handle(res);
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return handle(res);
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '—';
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

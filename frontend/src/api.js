const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function handle(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchWorkflows(repository) {
  const qs = repository && repository !== 'all' ? `?repository=${encodeURIComponent(repository)}` : '';
  const res = await fetch(`${API_BASE}/workflows${qs}`);
  return handle(res);
}

export async function syncWorkflows(repository) {
  const qs = repository && repository !== 'all' ? `?repository=${encodeURIComponent(repository)}` : '';
  const res = await fetch(`${API_BASE}/workflows/sync${qs}`, { method: 'POST' });
  return handle(res);
}

export async function fetchRepositories() {
  const res = await fetch(`${API_BASE}/repositories`);
  return handle(res);
}

export async function addRepository(owner, repo) {
  const res = await fetch(`${API_BASE}/repositories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo }),
  });
  return handle(res);
}

export async function removeRepositoryById(id) {
  const res = await fetch(`${API_BASE}/repositories/id/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return true;
}
export async function removeRepository(fullName) {
  const res = await fetch(`${API_BASE}/repositories/${fullName}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return true;
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return handle(res);
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '—';
}

function asUtcIso(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  if (/[zZ]$/.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso)) return iso;
  return `${iso}Z`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(asUtcIso(iso));
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
  return new Date(asUtcIso(iso)).toLocaleString();
}

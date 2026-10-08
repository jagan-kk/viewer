import { useEffect, useMemo, useState } from 'react'
import { fetchWorkflows, syncWorkflows, fetchHealth, shortSha, timeAgo, formatDate } from './api.js'

function statusKey(w) {
  if (w.conclusion) return w.conclusion
  return w.status || 'unknown'
}

function iconFor(w) {
  const k = statusKey(w)
  if (k === 'success') return { cls: 'success', glyph: '✓' }
  if (k === 'failure' || k === 'timed_out') return { cls: 'failure', glyph: '✕' }
  if (['in_progress', 'queued', 'waiting', 'requested', 'pending'].includes(k)) return { cls: 'running', glyph: '◌' }
  return { cls: 'muted', glyph: '○' }
}

function badgeClass(k) {
  const known = ['success', 'failure', 'timed_out', 'in_progress', 'queued', 'waiting', 'requested', 'cancelled', 'neutral', 'skipped', 'stale']
  return known.includes(k) ? `b-${k}` : 'b-default'
}

export default function App() {
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [healthy, setHealthy] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [conclusionFilter, setConclusionFilter] = useState('all')
  const [branchFilter, setBranchFilter] = useState('all')
  const [sortNewest, setSortNewest] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selected, setSelected] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  async function load(showSpinner = true) {
    try {
      if (showSpinner) setLoading(true)
      setError('')
      const [data, h] = await Promise.allSettled([fetchWorkflows(), fetchHealth()])
      if (data.status === 'fulfilled') setWorkflows(Array.isArray(data.value) ? data.value : [])
      else throw data.reason
      setHealthy(h.status === 'fulfilled')
    } catch (e) {
      setError(e.message || 'Failed to load workflows. Is the backend running on :8000?')
      setHealthy(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => load(false), 15000)
    return () => clearInterval(t)
  }, [autoRefresh])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function onSync() {
    try {
      setSyncing(true)
      setError('')
      const data = await syncWorkflows()
      setWorkflows(Array.isArray(data) ? data : [])
      setLastSync(new Date())
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const branches = useMemo(() => {
    const s = new Set(workflows.map((w) => w.branch).filter(Boolean))
    return ['all', ...[...s].sort()]
  }, [workflows])

  const stats = useMemo(() => {
    const total = workflows.length
    const ok = workflows.filter((w) => w.conclusion === 'success').length
    const fail = workflows.filter((w) => ['failure', 'timed_out'].includes(w.conclusion)).length
    const running = workflows.filter((w) => w.status !== 'completed').length
    const rate = total ? Math.round((ok / total) * 100) : 0
    return { total, ok, fail, running, rate }
  }, [workflows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = workflows.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false
      if (conclusionFilter !== 'all' && (w.conclusion || 'none') !== conclusionFilter) return false
      if (branchFilter !== 'all' && w.branch !== branchFilter) return false
      if (q) {
        const hay = `${w.name} ${w.branch} ${w.commit_sha} ${w.run_number}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      const da = new Date(a.created_at).getTime() || 0
      const db = new Date(b.created_at).getTime() || 0
      return sortNewest ? db - da : da - db
    })
    return list
  }, [workflows, query, statusFilter, conclusionFilter, branchFilter, sortNewest])

  return (
    <div className="app">
      <div className="bg-glow" />
      <div className="container">
        <header className="header">
          <div className="brand">
            <div className="logo">◉</div>
            <div>
              <h1>Release <span>Radar</span></h1>
              <p className="sub">
                <span className="repo-pill">jagan-kk / viewer_test</span>
                <span className="health-dot">
                  <span className={`dot ${healthy === null ? '' : healthy ? 'ok' : 'bad'}`} />
                  {healthy === null ? 'checking…' : healthy ? 'API connected' : 'API unreachable'}
                </span>
                {lastSync && <span>· synced {timeAgo(lastSync.toISOString())}</span>}
              </p>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={() => load()} disabled={loading}>
              {loading ? <span className="spin" /> : '↻'} Refresh
            </button>
            <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
              {syncing ? <span className="spin" /> : '⬇'} {syncing ? 'Syncing…' : 'Sync from GitHub'}
            </button>
          </div>
        </header>

        <section className="stats">
          <div className="stat accent"><div className="stat-label">Total runs</div><div className="stat-value">{stats.total}</div><div className="stat-hint">stored in Postgres</div></div>
          <div className="stat green"><div className="stat-label">Success rate</div><div className="stat-value">{stats.rate}%</div><div className="stat-hint">{stats.ok} successful</div></div>
          <div className="stat green"><div className="stat-label">Successful</div><div className="stat-value">{stats.ok}</div><div className="stat-hint">conclusion = success</div></div>
          <div className="stat red"><div className="stat-label">Failed</div><div className="stat-value">{stats.fail}</div><div className="stat-hint">failure / timed out</div></div>
          <div className="stat yellow"><div className="stat-label">In progress</div><div className="stat-value">{stats.running}</div><div className="stat-hint">not completed</div></div>
        </section>

        <div className="toolbar">
          <div className="search">
            <span className="search-icon">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, branch, SHA, run #…" />
          </div>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} title="Status">
            <option value="all">Status: all</option>
            <option value="queued">queued</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
          </select>
          <select className="select" value={conclusionFilter} onChange={(e) => setConclusionFilter(e.target.value)} title="Conclusion">
            <option value="all">Conclusion: all</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="cancelled">cancelled</option>
            <option value="skipped">skipped</option>
            <option value="timed_out">timed_out</option>
            <option value="none">none (running)</option>
          </select>
          <select className="select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} title="Branch">
            {branches.map((b) => <option key={b} value={b}>{b === 'all' ? 'Branch: all' : b}</option>)}
          </select>
          <div className="toolbar-right">
            <button className="select" onClick={() => setSortNewest(!sortNewest)} title="Toggle sort">
              {sortNewest ? '↓ Newest first' : '↑ Oldest first'}
            </button>
            <label className="check"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> auto-refresh 15s</label>
            <span className="count">{filtered.length} / {workflows.length} shown</span>
          </div>
        </div>

        {error && <div className="error-box" style={{ marginBottom: 12 }}><b>Error:</b> {error}<br /><span style={{ fontSize: 12.5, opacity: 0.85 }}>Check VITE_API_URL (defaults to /api → localhost:8000 via Vite proxy) and that FastAPI + CORS are running.</span></div>}

        <main className="grid">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" />)
          ) : filtered.length === 0 ? (
            <div className="state">
              <h3>No workflow runs found</h3>
              <div>{workflows.length === 0 ? 'Hit “Sync from GitHub” to pull the latest runs.' : 'Try clearing your search / filters.'}</div>
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary" onClick={onSync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
              </div>
            </div>
          ) : (
            filtered.map((w) => {
              const k = statusKey(w)
              const icon = iconFor(w)
              return (
                <article key={w.id} className={`card s-${k}`} onClick={() => setSelected(w)}>
                  <div className="card-top">
                    <div className="card-title">
                      <div className={`status-icon ${icon.cls}`}>{icon.glyph}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="name">{w.name}</div>
                        <div className="run-no">#{w.run_number} · id {w.id}</div>
                      </div>
                    </div>
                    <span className={`badge ${badgeClass(k)}`}>{k.replace('_', ' ')}</span>
                  </div>
                  <div className="card-meta">
                    <span className="meta-pill branch">⑂ {w.branch}</span>
                    <span className="meta-pill"><code>{shortSha(w.commit_sha)}</code></span>
                    <span className="meta-pill">{w.status}</span>
                  </div>
                  <div className="card-foot">
                    <span className="time" title={formatDate(w.created_at)}>created {timeAgo(w.created_at)} · updated {timeAgo(w.updated_at)}</span>
                    <a className="link" href={w.html_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>GitHub ↗</a>
                  </div>
                </article>
              )
            })
          )}
        </main>

        <footer className="footer">
          <span>Release Radar · FastAPI + Postgres + React · repo: jagan-kk/viewer_test</span>
          <span>{new Date().getFullYear()} · click a card for details</span>
        </footer>
      </div>

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>{selected.name} <span style={{ color: '#8b96ab', fontWeight: 500 }}>#{selected.run_number}</span></h2>
                <p>id {selected.id}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${badgeClass(statusKey(selected))}`}>{statusKey(selected)}</span>
                <button className="x" onClick={() => setSelected(null)}>✕</button>
              </div>
            </div>
            <div className="modal-body">
              <div className="kv"><b>Branch</b><span>⑂ {selected.branch}</span></div>
              <div className="kv"><b>Commit</b><span><code>{selected.commit_sha}</code></span></div>
              <div className="kv"><b>Status</b><span>{selected.status} · {selected.conclusion ?? 'no conclusion yet'}</span></div>
              <div className="kv"><b>Created</b><span>{formatDate(selected.created_at)} ({timeAgo(selected.created_at)})</span></div>
              <div className="kv"><b>Updated</b><span>{formatDate(selected.updated_at)} ({timeAgo(selected.updated_at)})</span></div>
              <div className="kv"><b>URL</b><span><code style={{ wordBreak: 'break-all' }}>{selected.html_url}</code></span></div>
            </div>
            <div className="modal-foot">
              <a className="btn btn-primary" href={selected.html_url} target="_blank" rel="noreferrer">Open in GitHub ↗</a>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

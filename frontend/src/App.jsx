import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchWorkflows, syncWorkflows, fetchHealth, fetchRepositories, addRepository, removeRepository, removeRepositoryById, shortSha, timeAgo, formatDate } from './api.js'

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
  const [repositories, setRepositories] = useState([])
  const [repoFilter, setRepoFilter] = useState('all')
  const [newRepo, setNewRepo] = useState('')
  const [addingRepo, setAddingRepo] = useState(false)
  const [removingRepo, setRemovingRepo] = useState(false)
  const [repoMenuOpen, setRepoMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [healthy, setHealthy] = useState(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [conclusionFilter, setConclusionFilter] = useState('all')
  const [branchFilter, setBranchFilter] = useState('all')
  const [sortNewest, setSortNewest] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selected, setSelected] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const inFlight = useRef(false)
  const repoFilterRef = useRef(repoFilter)
  repoFilterRef.current = repoFilter

  async function load(showSpinner = true) {
    if (inFlight.current) return
    inFlight.current = true
    try {
      if (showSpinner) setLoading(true)
      setError('')
      const [data, repos, h] = await Promise.allSettled([fetchWorkflows(repoFilterRef.current), fetchRepositories(), fetchHealth()])
      if (data.status === 'fulfilled') setWorkflows(Array.isArray(data.value) ? data.value : [])
      else throw data.reason
      if (repos.status === 'fulfilled' && Array.isArray(repos.value)) setRepositories(repos.value)
      setHealthy(h.status === 'fulfilled')
    } catch (e) {
      setError(e.message || 'Failed to load workflows. Is the backend running on :8000?')
      setHealthy(false)
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFilter])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => load(false), 15000)
    return () => clearInterval(t)
  }, [autoRefresh])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setSelected(null); setRepoMenuOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!repoMenuOpen) return
    function onDown(e) {
      if (!e.target.closest?.('.repo-dropdown')) setRepoMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [repoMenuOpen])

  async function onSync() {
    try {
      setSyncing(true)
      setError('')
      const data = await syncWorkflows(repoFilter)
      setWorkflows(Array.isArray(data) ? data : [])
      setLastSync(new Date())
      try {
        const repos = await fetchRepositories()
        if (Array.isArray(repos)) setRepositories(repos)
      } catch { /* repositories refresh is best-effort */ }
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function onRemoveRepo(name) {
    const target = name || repoFilter
    if (target === 'all' || removingRepo) return
    if (!window.confirm(`Stop monitoring ${target}? Its past runs stay in the list.`)) return
    try {
      setRemovingRepo(true)
      setError('')
      const entry = repositories.find((r) => (r.full_name || `${r.owner}/${r.name}`) === target)
      if (entry?.id != null) await removeRepositoryById(entry.id)
      else await removeRepository(target)
      if (target === repoFilter) setRepoFilter('all')
      setRepoMenuOpen(false)
      await load(false)
    } catch (err) {
      setError(err.message || 'Could not remove repository')
    } finally {
      setRemovingRepo(false)
    }
  }

  function parseRepoInput(input) {
    let s = (input || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '')
    const gh = s.match(/github\.com[/:]([^/]+)\/([^/]+)/i)
    if (gh) return { owner: gh[1].trim(), repo: gh[2].trim() }
    const [owner, ...rest] = s.split('/').map((x) => x.trim())
    return { owner: owner || '', repo: rest.join('/').trim() }
  }

  async function onAddRepo(e) {
    e?.preventDefault?.()
    const { owner, repo } = parseRepoInput(newRepo)
    if (!owner || !repo) {
      setError('Add a repo as owner/name, e.g. jagan-kk/BitBug')
      return
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      setError('Use plain owner/name (e.g. jagan-kk/BitBug), not a URL')
      return
    }
    try {
      setAddingRepo(true)
      setError('')
      await addRepository(owner, repo)
      setNewRepo('')
      setRepoFilter(`${owner}/${repo}`)
    } catch (err) {
      setError(err.message || 'Could not add repository')
    } finally {
      setAddingRepo(false)
    }
  }

  const repoOptions = useMemo(() => {
    const s = new Set([
      ...repositories.map((r) => r.full_name || `${r.owner}/${r.name}`).filter(Boolean),
      ...workflows.map((w) => w.repository).filter(Boolean),
    ])
    return ['all', ...[...s].sort()]
  }, [repositories, workflows])

  const monitoredRepos = useMemo(() => new Set(
    repositories.map((r) => r.full_name || `${r.owner}/${r.name}`).filter(Boolean),
  ), [repositories])

  const repoCounts = useMemo(() => {
    const m = new Map()
    for (const w of workflows) {
      if (w.repository) m.set(w.repository, (m.get(w.repository) || 0) + 1)
    }
    return m
  }, [workflows])

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
      if (repoFilter !== 'all' && (w.repository || '') !== repoFilter) return false
      if (statusFilter !== 'all' && w.status !== statusFilter) return false
      if (conclusionFilter !== 'all' && (w.conclusion || 'none') !== conclusionFilter) return false
      if (branchFilter !== 'all' && w.branch !== branchFilter) return false
      if (q) {
        const hay = `${w.name} ${w.branch} ${w.commit_sha} ${w.run_number} ${w.repository || ''}`.toLowerCase()
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
  }, [workflows, query, repoFilter, statusFilter, conclusionFilter, branchFilter, sortNewest])

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
                <span className="repo-pill">{repoFilter === 'all' ? `${repoOptions.length - 1} repo${repoOptions.length === 2 ? '' : 's'} monitored` : repoFilter}</span>
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

        <div className="toolbar toolbar-filters">
          <div className="search">
            <span className="search-icon">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, branch, SHA, run #…" />
          </div>
          <div className="repo-dropdown">
            <button className="select repo-toggle" onClick={() => setRepoMenuOpen((o) => !o)} title="Repository" aria-haspopup="listbox" aria-expanded={repoMenuOpen}>
              <span className="repo-toggle-label">{repoFilter === 'all' ? 'Repo: all' : repoFilter}</span>
              <span className="repo-caret">{repoMenuOpen ? '▴' : '▾'}</span>
            </button>
            {repoMenuOpen && (
              <div className="repo-menu" role="listbox">
                {repoOptions.map((r) => (
                  <div key={r} className={`repo-option ${repoFilter === r ? 'selected' : ''}`}>
                    <button
                      className="repo-option-label"
                      role="option"
                      aria-selected={repoFilter === r}
                      onClick={() => { setRepoFilter(r); setRepoMenuOpen(false) }}
                    >
                      {r === 'all' ? `Repo: all (${workflows.length})` : `${r} (${repoCounts.get(r) || 0})`}
                    </button>
                    {r !== 'all' && monitoredRepos.has(r) && (
                      <button
                        className="repo-remove"
                        title={`Stop monitoring ${r} (keeps past runs)`}
                        disabled={removingRepo}
                        onClick={(e) => { e.stopPropagation(); onRemoveRepo(r) }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
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
          <button className="select" onClick={() => setSortNewest(!sortNewest)} title="Toggle sort">
            {sortNewest ? '↓ Newest first' : '↑ Oldest first'}
          </button>
          <div className="toolbar-right">
            <label className="check"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> auto-refresh 15s</label>
            <span className="count">{filtered.length} / {workflows.length} shown</span>
          </div>
        </div>

        <form className="toolbar" onSubmit={onAddRepo} style={{ top: 'auto' }}>
          <div className="search">
            <span className="search-icon">＋</span>
            <input value={newRepo} onChange={(e) => setNewRepo(e.target.value)} placeholder="Add repo to monitor: owner/name…" />
          </div>
          <button className="btn" type="submit" disabled={addingRepo || !newRepo.trim()}>
            {addingRepo ? <span className="spin" /> : '＋'} {addingRepo ? 'Adding…' : 'Monitor repo'}
          </button>
          <span className="count">sync covers {repoFilter === 'all' ? 'all monitored repos' : repoFilter}</span>
        </form>

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
                    {w.repository && <span className="meta-pill branch">▣ {w.repository}</span>}
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
          <span>Release Radar · FastAPI + Postgres + React · {repositories.length} repo{repositories.length === 1 ? '' : 's'} monitored</span>
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
              {selected.repository && <div className="kv"><b>Repository</b><span>▣ {selected.repository}</span></div>}
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

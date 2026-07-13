import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LegalPage, MarketingSite, NotFoundPage } from './MarketingSite';

type User = { id: string; name: string; email: string };
type Organization = { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' };
type Board = { id: string; name: string; slug: string };
type Comment = { id: string; body: string; authorName: string; createdAt?: string };
type StatusHistory = { status: Status; createdAt: string };
type Status = 'under_review' | 'planned' | 'in_progress' | 'shipped';
type FeedbackPost = {
  id: string;
  title: string;
  description: string;
  status: Status;
  authorName: string;
  voteCount: number;
  commentCount: number;
  comments: Comment[];
  statusHistory: StatusHistory[];
  createdAt: string;
};
type BoardData = { board: Board & { organizationName: string }; posts: FeedbackPost[] };

type Phase = 'loading' | 'auth' | 'workspace' | 'board-setup' | 'board' | 'public-board';

const statusLabels: Record<Status, string> = {
  under_review: 'Under review',
  planned: 'Planned',
  in_progress: 'In progress',
  shipped: 'Shipped',
};

const publicDemoSnapshot: BoardData = {
  board: {
    id: 'demo-board-snapshot',
    name: 'Production Feedback',
    slug: 'vercel-production-feedback',
    organizationName: 'Vercel Verification Workspace',
  },
  posts: [{
    id: 'demo-post-snapshot',
    title: 'Hosted smoke-test evidence',
    description: 'Verify that the Vercel frontend, Express function, secure cookie, and Supabase database work together over HTTPS.',
    status: 'planned',
    authorName: 'Vercel Smoke User',
    voteCount: 1,
    commentCount: 1,
    comments: [{ id: 'demo-comment-snapshot', body: 'Hosted comment persistence verified.', authorName: 'Vercel Smoke User' }],
    statusHistory: [
      { status: 'under_review', createdAt: '2026-07-13T19:38:41.896Z' },
      { status: 'planned', createdAt: '2026-07-13T19:39:37.614Z' },
    ],
    createdAt: '2026-07-13T19:38:41.896Z',
  }],
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body ? { 'Content-Type': 'application/json', ...options.headers } : options?.headers,
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload as T;
}

function publicSlugFromPath() {
  const match = window.location.pathname.match(/^\/b\/([a-z0-9-]+)\/?$/);
  return match?.[1] ?? null;
}

function ProductApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login'>(() => (
    new URLSearchParams(window.location.search).get('mode') === 'login' ? 'login' : 'register'
  ));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [demoSnapshot, setDemoSnapshot] = useState(false);
  const [filter, setFilter] = useState<Status | 'all'>('all');

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    const publicSlug = publicSlugFromPath();
    if (publicSlug) {
      try {
        const data = await api<BoardData>(`/api/boards/${publicSlug}`);
        setBoardData(data);
        setDemoSnapshot(false);
        try {
          const me = await api<{ user: User }>('/api/me');
          setUser(me.user);
        } catch {
          setUser(null);
        }
        setPhase('public-board');
      } catch (caught) {
        if (publicSlug === publicDemoSnapshot.board.slug) {
          setBoardData(publicDemoSnapshot);
          setUser(null);
          setError('');
          setDemoSnapshot(true);
          setPhase('public-board');
        } else {
          setError(caught instanceof Error ? caught.message : 'Board not found.');
          setPhase('auth');
        }
      }
      return;
    }

    try {
      const me = await api<{ user: User }>('/api/me');
      setUser(me.user);
      await loadOrganizations();
    } catch {
      setPhase('auth');
    }
  }

  async function loadOrganizations() {
    const result = await api<{ organizations: Organization[] }>('/api/organizations');
    setOrganizations(result.organizations);
    if (!result.organizations.length) {
      setOrganization(null);
      setPhase('workspace');
      return;
    }
    const first = result.organizations[0];
    setOrganization(first);
    await loadBoards(first);
  }

  async function loadBoards(selected: Organization) {
    const result = await api<{ boards: Board[] }>(`/api/organizations/${selected.id}/boards`);
    if (!result.boards.length) {
      setBoardData(null);
      setPhase('board-setup');
      return;
    }
    await loadBoard(result.boards[0].slug, 'board');
  }

  async function loadBoard(slug: string, nextPhase: Phase = 'board') {
    const data = await api<BoardData>(`/api/boards/${slug}`);
    setBoardData(data);
    setPhase(nextPhase);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = authMode === 'register'
      ? { name: form.get('name'), email: form.get('email'), password: form.get('password') }
      : { email: form.get('email'), password: form.get('password') };
    try {
      const result = await api<{ user: User }>(`/api/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setUser(result.user);
      await loadOrganizations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ organization: Organization }>('/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name') }),
      });
      setOrganizations([result.organization]);
      setOrganization(result.organization);
      setPhase('board-setup');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function submitBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ board: Board }>(`/api/organizations/${organization.id}/boards`, {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), slug: form.get('slug') }),
      });
      await loadBoard(result.board.slug);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the board.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!boardData) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/boards/${boardData.board.id}/posts`, {
        method: 'POST',
        body: JSON.stringify({ title: form.get('title'), description: form.get('description') }),
      });
      setShowPostForm(false);
      await loadBoard(boardData.board.slug, phase === 'public-board' ? 'public-board' : 'board');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not submit feedback.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleVote(postId: string) {
    if (!user) {
      setPhase('auth');
      setError('Sign in to vote.');
      return;
    }
    setError('');
    try {
      await api(`/api/posts/${postId}/vote`, { method: 'POST' });
      if (boardData) await loadBoard(boardData.board.slug, phase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the vote.');
    }
  }

  async function changeStatus(postId: string, status: Status) {
    setError('');
    try {
      await api(`/api/posts/${postId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (boardData) await loadBoard(boardData.board.slug, phase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the status.');
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>, postId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError('');
    try {
      await api(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body: form.get('body') }) });
      formElement.reset();
      if (boardData) await loadBoard(boardData.board.slug, phase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the comment.');
    }
  }

  async function switchOrganization(id: string) {
    const selected = organizations.find((item) => item.id === id);
    if (!selected) return;
    setOrganization(selected);
    await loadBoards(selected);
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setOrganizations([]);
    setOrganization(null);
    setBoardData(null);
    setPhase('auth');
  }

  const filteredPosts = useMemo(() => {
    if (!boardData) return [];
    return filter === 'all' ? boardData.posts : boardData.posts.filter((post) => post.status === filter);
  }, [boardData, filter]);

  if (phase === 'loading') {
    return <><main id="main-content" tabIndex={-1} className="center-shell"><p className="loading-line">Opening the signal room…</p></main></>;
  }

  if (phase === 'auth') {
    return (
      <><main id="main-content" tabIndex={-1} className="auth-shell">
        <section className="auth-story" aria-labelledby="auth-title">
          <div className="brand-mark"><span aria-hidden="true">S</span> SignalRoom</div>
          <p className="eyebrow">Customer feedback, without the archaeology</p>
          <h1 id="auth-title">Turn scattered requests into a roadmap your customers can see.</h1>
          <p className="lede">Collect ideas, surface demand, and show what your team is doing next. No fake AI prioritization. Just a clean signal.</p>
          <div className="signal-demo" aria-label="Example feedback pipeline">
            <span className="signal-dot review" /> Under review
            <span className="signal-line" />
            <span className="signal-dot planned" /> Planned
            <span className="signal-line" />
            <span className="signal-dot shipped" /> Shipped
          </div>
        </section>
        <section className="auth-panel" aria-label="Account access">
          <div className="auth-tabs" role="tablist" aria-label="Account action">
            <button role="tab" aria-selected={authMode === 'register'} onClick={() => { setAuthMode('register'); setError(''); }}>Create account</button>
            <button role="tab" aria-selected={authMode === 'login'} onClick={() => { setAuthMode('login'); setError(''); }}>Sign in</button>
          </div>
          <h2>{authMode === 'register' ? 'Start your feedback board' : 'Welcome back'}</h2>
          <p className="muted">{authMode === 'register' ? 'Build the workspace first. Billing can wait.' : 'Sign in to manage your roadmap.'}</p>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <form onSubmit={submitAuth} className="stack-form">
            {authMode === 'register' && <label>Name<input name="name" autoComplete="name" minLength={2} maxLength={60} required /></label>}
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={authMode === 'register' ? 12 : undefined} required /></label>
            {authMode === 'register' && <p className="field-note">Use at least 12 characters.</p>}
            <button className="primary-button" disabled={busy}>{busy ? 'Working…' : authMode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
        </section>
      </main></>
    );
  }

  if (phase === 'workspace' || phase === 'board-setup') {
    const creatingWorkspace = phase === 'workspace';
    return (
      <><main id="main-content" tabIndex={-1} className="setup-shell">
        <header className="setup-header"><div className="brand-mark"><span aria-hidden="true">S</span> SignalRoom</div><p>{user?.email}</p></header>
        <section className="setup-card">
          <p className="step-label">Setup {creatingWorkspace ? '01' : '02'} / 02</p>
          <h1>{creatingWorkspace ? 'Create your workspace' : 'Open your first feedback board'}</h1>
          <p>{creatingWorkspace ? 'A workspace holds your boards, teammates, and moderation rules.' : 'Customers will use this public URL to submit requests and follow progress.'}</p>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <form key={creatingWorkspace ? 'workspace-form' : 'board-form'} onSubmit={creatingWorkspace ? submitWorkspace : submitBoard} className="stack-form">
            <label>{creatingWorkspace ? 'Workspace name' : 'Board name'}<input name="name" placeholder={creatingWorkspace ? 'Acme Labs' : 'Product feedback'} minLength={2} maxLength={80} required /></label>
            {!creatingWorkspace && <label>Public slug<div className="slug-input"><span>/b/</span><input name="slug" placeholder="product-feedback" pattern="[a-z0-9-]+" minLength={2} maxLength={60} required /></div></label>}
            <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : creatingWorkspace ? 'Create workspace' : 'Create board'}</button>
          </form>
        </section>
      </main></>
    );
  }

  if (!boardData) return <><main id="main-content" tabIndex={-1} className="center-shell"><p>No board is selected.</p></main></>;

  const canModerate = Boolean(organization && ['owner', 'admin'].includes(organization.role));

  return (
    <><div className="app-shell">
      <header className="app-header">
        <a className="brand-mark" href="/" onClick={(event) => event.preventDefault()}><span aria-hidden="true">S</span> SignalRoom</a>
        <div className="header-actions">
          {organization && organizations.length > 0 && (
            <label className="workspace-picker"><span className="sr-only">Workspace</span><select value={organization.id} onChange={(event) => void switchOrganization(event.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          )}
          {user ? <><span className="user-chip">{user.name}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></> : <button className="primary-button compact" onClick={() => setPhase('auth')}>Sign in to participate</button>}
        </div>
      </header>

      <aside className="status-rail" aria-label="Roadmap filters">
        <p className="rail-label">Signal channels</p>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}><span>All feedback</span><strong>{boardData.posts.length}</strong></button>
        {(Object.keys(statusLabels) as Status[]).map((status) => (
          <button key={status} className={`${filter === status ? 'active' : ''} status-${status}`} onClick={() => setFilter(status)}>
            <span>{statusLabels[status]}</span><strong>{boardData.posts.filter((post) => post.status === status).length}</strong>
          </button>
        ))}
        <div className="public-link"><span>Public board</span><a href={`/b/${boardData.board.slug}`}>/b/{boardData.board.slug}</a></div>
      </aside>

      <main id="main-content" tabIndex={-1} className="board-main">
        {demoSnapshot && <p className="snapshot-banner" role="status">Live preview data is unavailable. Showing a read-only demo snapshot.</p>}
        <section className="board-heading">
          <div><p className="eyebrow">{boardData.board.organizationName}</p><h1>{boardData.board.name}</h1><p>Requests ranked by customer signal, with every roadmap decision visible.</p></div>
          {user && <button className="primary-button" onClick={() => setShowPostForm((open) => !open)}>{showPostForm ? 'Close form' : 'Share feedback'}</button>}
        </section>

        {error && <p className="error-banner" role="alert">{error}</p>}

        {showPostForm && (
          <section className="new-post-panel" aria-labelledby="new-post-title">
            <p className="step-label">New signal</p><h2 id="new-post-title">What should the product do better?</h2>
            <form onSubmit={submitPost} className="stack-form">
              <label>Short title<input name="title" minLength={4} maxLength={120} placeholder="Keyboard shortcuts for the feedback queue" required /></label>
              <label>Why it matters<textarea name="description" minLength={10} maxLength={2000} rows={4} placeholder="Describe the workflow this would improve." required /></label>
              <button className="primary-button" disabled={busy}>{busy ? 'Submitting…' : 'Submit feedback'}</button>
            </form>
          </section>
        )}

        <section className="queue-toolbar" aria-label="Feedback queue summary"><h2>{filter === 'all' ? 'All feedback' : statusLabels[filter]}</h2><p>{filteredPosts.length} {filteredPosts.length === 1 ? 'request' : 'requests'}</p></section>

        <section className="feedback-list" aria-live="polite">
          {!filteredPosts.length && <div className="empty-state"><p className="step-label">Quiet channel</p><h2>No requests here yet.</h2><p>{user ? 'Share the first piece of feedback or choose another status.' : 'Sign in to share the first request.'}</p></div>}
          {filteredPosts.map((post) => (
            <article className={`feedback-card status-${post.status}`} key={post.id}>
              <div className="card-signal" aria-hidden="true" />
              <button className="vote-button" onClick={() => void toggleVote(post.id)} aria-label={`Vote for ${post.title}. ${post.voteCount} ${post.voteCount === 1 ? 'vote' : 'votes'}`}><span>▲</span><strong>{post.voteCount}</strong></button>
              <div className="feedback-copy">
                <div className="card-meta"><span className="status-pill">{statusLabels[post.status]}</span><span>by {post.authorName}</span></div>
                <h3>{post.title}</h3><p>{post.description}</p>
                {post.comments.length > 0 && <div className="comments"><h4>Conversation</h4>{post.comments.map((comment) => <blockquote key={comment.id}><p>{comment.body}</p><cite>{comment.authorName}</cite></blockquote>)}</div>}
                {user && <form className="comment-form" onSubmit={(event) => void submitComment(event, post.id)}><label className="sr-only" htmlFor={`comment-${post.id}`}>Add a comment to {post.title}</label><input id={`comment-${post.id}`} name="body" minLength={2} maxLength={1000} placeholder="Add context…" required /><button>Comment</button></form>}
              </div>
              {canModerate && <label className="status-control">Status<select value={post.status} onChange={(event) => void changeStatus(post.id, event.target.value as Status)}>{(Object.keys(statusLabels) as Status[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>}
            </article>
          ))}
        </section>
      </main>
    </div></>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/') return <MarketingSite />;
  if (path === '/privacy') return <LegalPage kind="privacy" />;
  if (path === '/terms') return <LegalPage kind="terms" />;
  if (path === '/app' || /^\/b\/[a-z0-9-]+$/.test(path)) return <ProductApp />;
  return <NotFoundPage />;
}

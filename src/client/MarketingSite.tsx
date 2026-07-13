import { type FormEvent, useState } from 'react';
import { productConfig } from './productConfig';

const workflow = [
  ['Collect', 'Give customers one public board for requests, comments, and visible conversation.'],
  ['Prioritize', 'Let signed-in customers cast one vote per post while your team keeps moderation control.'],
  ['Communicate', 'Move requests through under review, planned, in progress, and shipped with status history.'],
] as const;

const features = [
  ['Public boards', 'A stable place for customers to submit and follow requests.'],
  ['Customer signal', 'One vote per user per post, plus comments that preserve context.'],
  ['Roadmap status', 'Four clear stages and visible status history instead of repeated inbox replies.'],
  ['Team boundaries', 'Organizations, membership roles, and owner/admin moderation controls.'],
] as const;

const audiences = [
  ['Founders', 'See demand without searching every customer conversation.'],
  ['Product managers', 'Run a visible triage queue and explain what moves next.'],
  ['Support teams', 'Point customers to one answer for request and roadmap status.'],
] as const;

function Brand() {
  return <a className="brand-mark" href="/"><span aria-hidden="true">S</span> SignalRoom</a>;
}

async function recordEvent(event: string, properties: Record<string, string>) {
  try {
    await fetch('/api/marketing/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, properties }),
    });
  } catch {
    // Analytics must never block navigation or form use.
  }
}

function ProductUpdatesForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch('/api/marketing/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), company: form.get('company'), website: form.get('website') }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The update request could not be saved.');
      setMessage('Your update request is saved. No confirmation email is promised in the current preview.');
      formElement.reset();
      await recordEvent('lead_form_succeeded', { route: '/' });
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : 'The update request could not be saved.';
      setFailed(true);
      setMessage(errorMessage);
      await recordEvent('lead_form_failed', { route: '/', failureCategory: errorMessage.includes('Too many') ? 'rate_limit' : 'storage' });
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (started) return;
    setStarted(true);
    void recordEvent('lead_form_started', { route: '/' });
  }

  return <section className="marketing-section updates-section">
    <div><p className="eyebrow">Product updates</p><h2>Follow what SignalRoom ships next.</h2><p>Request occasional product-update notices. This is separate from account creation and does not promise a delivery schedule.</p></div>
    <form className="updates-form" onSubmit={submit} onFocus={start}>
      <label>Email for product updates<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>Company (optional)<input name="company" autoComplete="organization" maxLength={100} /></label>
      <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <button className="primary-button" disabled={busy}>{busy ? 'Saving request…' : 'Request product updates'}</button>
      {message && <p className={failed ? 'error-banner' : 'success-banner'} role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
  </section>;
}

export function MarketingSite() {
  return <div className="marketing-shell">
    <header className="marketing-header">
      <Brand />
      <nav aria-label="Primary navigation">
        <a href="#workflow">How it works</a>
        <a href="#features">Features</a>
        <a href="#pricing">Availability</a>
        <a href={productConfig.routes.login}>Sign in</a>
        <a className="primary-button compact" href={productConfig.routes.register}>Start a free workspace</a>
      </nav>
    </header>

    <main id="main-content" tabIndex={-1}>
      <section className="marketing-hero">
        <div className="hero-copy">
          <p className="eyebrow">A public feedback room for small SaaS teams</p>
          <h1>Collect product feedback without losing requests in email and chat.</h1>
          <p className="hero-lede">Give customers one public board to submit ideas, vote on priorities, and follow roadmap status while your team keeps moderation boundaries intact.</p>
          <div className="hero-actions">
            <a className="primary-button" href={productConfig.routes.register}>Start a free workspace</a>
            <a className="secondary-button" href={productConfig.routes.demo}>View the public demo board</a>
          </div>
          <p className="availability-note">{productConfig.availability.detail}</p>
        </div>
        <div className="signal-ledger" aria-label="Synthetic example feedback board">
          <div className="ledger-head"><span>Public request ledger</span><span>Synthetic data</span></div>
          <article><span className="ledger-vote">18 ▲</span><div><strong>Keyboard shortcuts for triage</strong><p>Move through the request queue without reaching for a mouse.</p></div><span className="status-pill status-planned">Planned</span></article>
          <article><span className="ledger-vote">11 ▲</span><div><strong>Weekly roadmap digest</strong><p>See what changed without checking every request.</p></div><span className="status-pill status-in_progress">In progress</span></article>
          <article><span className="ledger-vote">7 ▲</span><div><strong>Custom board categories</strong><p>Group requests around the parts of a product customers know.</p></div><span className="status-pill status-under_review">Under review</span></article>
          <div className="ledger-track"><span>Under review</span><i /><span>Planned</span><i /><span>In progress</span><i /><span>Shipped</span></div>
        </div>
      </section>

      <section className="marketing-section problem-section">
        <p className="eyebrow">The inbox is not a roadmap</p>
        <h2>From scattered messages to a visible roadmap.</h2>
        <div className="problem-grid"><p>Email hides context.</p><p>Chat repeats the same status question.</p><p>Spreadsheets show the team, not the customer.</p><p>SignalRoom keeps the request, demand, discussion, and status in one public record.</p></div>
      </section>

      <section className="marketing-section" id="workflow">
        <p className="eyebrow">A sequence that matches the work</p>
        <h2>Collect. Prioritize. Communicate.</h2>
        <div className="workflow-grid">{workflow.map(([title, copy], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="marketing-section feature-section" id="features">
        <p className="eyebrow">What exists in the product today</p>
        <h2>Enough structure to make feedback accountable.</h2>
        <div className="feature-grid">{features.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="marketing-section">
        <p className="eyebrow">Use cases</p>
        <h2>Built for the people closest to the requests.</h2>
        <div className="audience-grid">{audiences.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="marketing-section proof-section">
        <div><p className="eyebrow">Product proof without fake customer data</p><h2>A real board model, shown with synthetic data.</h2><p>The ledger above mirrors the current product: public requests, votes, comments, roadmap status, and moderation boundaries. The labels and request text are synthetic.</p></div>
        <a className="secondary-button" href={productConfig.routes.demo}>Open the live demo board</a>
      </section>

      <section className="marketing-section availability-section" id="pricing">
        <div><p className="eyebrow">Availability</p><h2>Free preview. No invented pricing.</h2><p>{productConfig.availability.detail}</p><p>Billing, paid limits, and private boards remain deferred.</p></div>
        <a className="primary-button" href={productConfig.routes.register}>Open a preview workspace</a>
      </section>

      <section className="marketing-section faq-section">
        <p className="eyebrow">FAQ</p><h2>Questions before you open a workspace.</h2>
        <details><summary>Can customers submit and vote on requests?</summary><p>Yes. Signed-in customers can submit feedback, comment, and toggle one vote per post.</p></details>
        <details><summary>Who can change roadmap status?</summary><p>Workspace owners and admins control moderation and status changes.</p></details>
        <details><summary>Does SignalRoom have paid plans?</summary><p>No. The current public build is a free preview and paid plans are not launched.</p></details>
        <details><summary>Are private boards or email notifications available?</summary><p>Not yet. Private boards, invitations, and transactional notifications remain deferred.</p></details>
      </section>

      <ProductUpdatesForm />

      <section className="marketing-final">
        <p className="eyebrow">Give every request a visible home</p><h2>Stop answering roadmap questions one message at a time.</h2>
        <a className="primary-button" href={productConfig.routes.register}>Start a free workspace</a>
      </section>
    </main>

    <footer className="marketing-footer"><Brand /><p>Customer feedback without the archaeology.</p><nav aria-label="Legal"><a href={productConfig.routes.privacy}>Privacy</a><a href={productConfig.routes.terms}>Terms</a></nav></footer>
  </div>;
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return <div className="legal-shell"><header className="marketing-header"><Brand /><a href="/">Back to homepage</a></header><main id="main-content" tabIndex={-1}>
    <p className="eyebrow">Legal structure</p><h1>{privacy ? 'Privacy notice' : 'Terms of use'}</h1>
    <p className="legal-review">This page is a product structure draft and requires legal review before it is treated as legal advice or a final policy.</p>
    {privacy ? <><section><h2>Information handled by the service</h2><p>Account, workspace, feedback, comment, session, and optional product-update information may be processed to provide the service.</p></section><section><h2>Purpose and retention</h2><p>Collection purpose, retention periods, deletion requests, subprocessors, and jurisdiction terms require review before final publication.</p></section></> : <><section><h2>Preview service</h2><p>SignalRoom is currently provided as a free preview. Billing and paid service levels have not launched.</p></section><section><h2>Acceptable use and responsibility</h2><p>Final account responsibilities, prohibited uses, warranties, liability, termination, and governing-law terms require legal review.</p></section></>}
  </main></div>;
}

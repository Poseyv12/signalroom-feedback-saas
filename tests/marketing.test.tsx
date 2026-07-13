import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/client/App';

describe('SignalRoom public routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders the marketing homepage with truthful CTA destinations and availability', () => {
    render(<App />);

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Collect product feedback without losing requests in email and chat.',
    })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Start a free workspace' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Start a free workspace' }).every((link) => (
      link.getAttribute('href') === '/app?mode=register'
    ))).toBe(true);
    expect(screen.getByRole('link', { name: 'View the public demo board' })).toHaveAttribute('href', '/b/vercel-production-feedback');
    expect(screen.getAllByText(/paid plans have not launched/i)).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'From scattered messages to a visible roadmap.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collect. Prioritize. Communicate.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Built for the people closest to the requests.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A real board model, shown with synthetic data.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Free preview. No invented pricing.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions before you open a workspace.' })).toBeInTheDocument();
  });

  it('uses the requested authentication mode on the app route', async () => {
    window.history.replaceState({}, '', '/app?mode=login');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Sign in to continue.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it.each([
    ['/privacy', 'Privacy notice'],
    ['/terms', 'Terms of use'],
  ])('renders the %s legal structure with review status', (path, heading) => {
    window.history.replaceState({}, '', path);
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByText(/requires legal review/i)).toBeInTheDocument();
  });

  it('renders a branded 404 without bootstrapping the product app', () => {
    window.history.replaceState({}, '', '/missing-page');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'This signal went quiet.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to SignalRoom' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Open the product' })).toHaveAttribute('href', '/app');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores a product-update request and keeps personal data out of analytics', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/marketing/leads') return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email for product updates'), 'updates@example.com');
    await user.type(screen.getByLabelText('Company (optional)'), 'Acme Labs');
    await user.click(screen.getByRole('button', { name: 'Request product updates' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your update request is saved.');
    const analyticsBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/marketing/events')
      .map(([, options]) => String(options?.body));
    expect(analyticsBodies.length).toBeGreaterThan(0);
    expect(analyticsBodies.join(' ')).not.toContain('updates@example.com');
    expect(analyticsBodies.join(' ')).not.toContain('Acme Labs');
  });

  it('shows a server failure and preserves the email for retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/marketing/leads') return Promise.resolve(new Response(JSON.stringify({ error: 'Update storage is unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    });
    render(<App />);
    const user = userEvent.setup();
    const email = screen.getByLabelText('Email for product updates');

    await user.type(email, 'retry@example.com');
    await user.click(screen.getByRole('button', { name: 'Request product updates' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Update storage is unavailable.');
    expect(email).toHaveValue('retry@example.com');
  });
});
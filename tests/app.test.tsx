import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/client/App';

function response(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('SignalRoom onboarding', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('registers a user and moves to workspace creation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response(401, { error: 'Sign in to continue.' }))
      .mockImplementationOnce(() => response(201, { user: { id: 'u1', name: 'Vance', email: 'vance@example.com' } }))
      .mockImplementationOnce(() => response(200, { organizations: [] }));

    render(<App />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: /turn scattered requests into a roadmap/i });
    expect(document.getElementById('main-content')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Vance');
    await user.type(screen.getByLabelText('Email'), 'vance@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Create your workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows a useful registration error from the server', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response(401, { error: 'Sign in to continue.' }))
      .mockImplementationOnce(() => response(409, { error: 'An account already exists for that email.' }));

    render(<App />);
    const user = userEvent.setup();
    await screen.findByLabelText('Name');
    await user.type(screen.getByLabelText('Name'), 'Vance');
    await user.type(screen.getByLabelText('Email'), 'vance@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An account already exists for that email.');
  });

  it('submits a comment, clears the form, and reloads the conversation', async () => {
    window.history.replaceState({}, '', '/b/product-feedback');
    const board = {
      board: { id: 'b1', name: 'Product Feedback', slug: 'product-feedback', organizationName: 'Acme' },
      posts: [{
        id: 'p1', title: 'Keyboard shortcuts', description: 'Move through the queue faster.',
        status: 'planned', authorName: 'Owner', voteCount: 1, commentCount: 0,
        comments: [], statusHistory: [], createdAt: '2026-07-13T00:00:00Z',
      }],
    };
    const updated = {
      ...board,
      posts: [{ ...board.posts[0], commentCount: 1, comments: [{ id: 'c1', body: 'Useful for weekly triage.', authorName: 'Vance' }] }],
    };
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response(200, board))
      .mockImplementationOnce(() => response(200, { user: { id: 'u1', name: 'Vance', email: 'vance@example.com' } }))
      .mockImplementationOnce(() => response(201, { comment: { id: 'c1', body: 'Useful for weekly triage.', authorName: 'Vance' } }))
      .mockImplementationOnce(() => response(200, updated));

    render(<App />);
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Add a comment to Keyboard shortcuts');
    expect(screen.getByRole('button', { name: 'Vote for Keyboard shortcuts. 1 vote' })).toBeInTheDocument();
    await user.type(input, 'Useful for weekly triage.');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Useful for weekly triage.')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

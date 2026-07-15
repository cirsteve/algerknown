import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { GovernanceAuthProvider, GovernanceGate, useGovernanceAuth } from '../../../src/client/auth';
import { server } from '../mocks/server';
import { AUTH_SESSION } from '../mocks/handlers';

function Protected() {
  const { governanceFetch } = useGovernanceAuth();
  return (
    <div>
      <p>Protected content</p>
      <button onClick={() => governanceFetch('/api/governance/proposals/prop-1')}>Make a governed request</button>
    </div>
  );
}

describe('governance auth gating', () => {
  it('shows the unlock form when no session exists, then reveals content after a successful unlock', async () => {
    server.use(http.get('/api/governance/auth/session', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));

    render(
      <GovernanceAuthProvider>
        <GovernanceGate>
          <Protected />
        </GovernanceGate>
      </GovernanceAuthProvider>,
    );

    expect(await screen.findByText('Unlock governance review')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Reviewer secret'), 'the-reviewer-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    expect(await screen.findByText('Steve')).toBeInTheDocument();
  });

  it('shows an error and stays locked on an incorrect secret', async () => {
    server.use(
      http.get('/api/governance/auth/session', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
      http.post('/api/governance/auth/unlock', () => HttpResponse.json({ error: 'incorrect_secret' }, { status: 401 })),
    );

    render(
      <GovernanceAuthProvider>
        <GovernanceGate>
          <Protected />
        </GovernanceGate>
      </GovernanceAuthProvider>,
    );

    await userEvent.type(await screen.findByPlaceholderText('Reviewer secret'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText('Incorrect secret.')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders content immediately when a session already exists', async () => {
    server.use(http.get('/api/governance/auth/session', () => HttpResponse.json(AUTH_SESSION)));

    render(
      <GovernanceAuthProvider>
        <GovernanceGate>
          <Protected />
        </GovernanceGate>
      </GovernanceAuthProvider>,
    );

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('drops back to the unlock screen on a 401 from a governed request, without leaking the CSRF token', async () => {
    server.use(http.get('/api/governance/auth/session', () => HttpResponse.json(AUTH_SESSION)));

    render(
      <GovernanceAuthProvider>
        <GovernanceGate>
          <Protected />
        </GovernanceGate>
      </GovernanceAuthProvider>,
    );

    await screen.findByText('Protected content');

    server.use(http.get('/api/governance/proposals/prop-1', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));
    await userEvent.click(screen.getByRole('button', { name: 'Make a governed request' }));

    await waitFor(() => expect(screen.getByText('Unlock governance review')).toBeInTheDocument());
    expect(screen.queryByText(/Reviewing as/)).not.toBeInTheDocument();
  });
});

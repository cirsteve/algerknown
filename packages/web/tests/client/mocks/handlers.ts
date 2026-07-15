import { http, HttpResponse } from 'msw';
import { node1HistoryResponse, pendingProposalDetail, pendingProposalQueueItem } from '../fixtures/proposal';

export const AUTH_SESSION = { reviewer: { id: 'steve', displayName: 'Steve' }, expiresAt: '2026-01-02T00:00:00.000Z', csrfToken: 'test-csrf-token' };

/** Default happy-path handlers; individual tests override with server.use(...) for conflicts/errors. */
export const handlers = [
  http.get('/api/governance/auth/session', () => HttpResponse.json(AUTH_SESSION)),
  http.post('/api/governance/auth/unlock', () => HttpResponse.json(AUTH_SESSION)),
  http.post('/api/governance/auth/logout', () => HttpResponse.json({})),

  http.get('/api/governance/proposals', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const items = status && status !== pendingProposalQueueItem.status ? [] : [pendingProposalQueueItem];
    return HttpResponse.json({ items, nextCursor: null });
  }),

  http.get('/api/governance/proposals/:id', ({ params }) => {
    if (params.id !== pendingProposalDetail.id) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return HttpResponse.json(pendingProposalDetail);
  }),

  http.get('/api/governance/proposals/:id/history', () => HttpResponse.json({ events: pendingProposalDetail.events })),

  http.get('/api/governance/nodes/:id/history', () => HttpResponse.json(node1HistoryResponse)),

  http.post('/api/governance/proposals/:id/amend', () => HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'pending' })),
  http.post('/api/governance/proposals/:id/accept', () => HttpResponse.json({ status: 'accepted', resultingRevision: 4 })),
  http.post('/api/governance/proposals/:id/reject', () => HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'rejected' })),
  http.post('/api/governance/proposals/:id/expire', () => HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'expired' })),
  http.post('/api/governance/proposals/:id/delete', () => HttpResponse.json({ id: pendingProposalDetail.id, version: 2, status: 'deleted' })),
  http.post('/api/governance/proposals/:id/revert', () => HttpResponse.json({ status: 'reverted', newRevision: 5 })),
];

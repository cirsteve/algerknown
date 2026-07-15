import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { DemoManifest } from './demo-fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const demoDir = path.join(repoRoot, 'build', 'phase2-demo');
const manifest: DemoManifest = JSON.parse(fs.readFileSync(path.join(demoDir, 'seed-manifest.json'), 'utf-8'));

interface TranscriptStep {
  step: string;
  detail: string;
  at: string;
}
const transcript: TranscriptStep[] = [];
function record(step: string, detail: string): void {
  transcript.push({ step, detail, at: new Date().toISOString() });
}

test.afterAll(() => {
  fs.mkdirSync(demoDir, { recursive: true });
  fs.writeFileSync(path.join(demoDir, 'review-transcript.json'), JSON.stringify(transcript, null, 2));
  const md = [
    '# Phase 2 governance demo -- recorded review session transcript',
    '',
    ...transcript.map((s) => `- **${s.step}** (${s.at}): ${s.detail}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(demoDir, 'review-transcript.md'), md);
});

test('recorded Algerknown governance review session', async ({ page }) => {
  test.setTimeout(120_000);
  // Auto-accept any native confirm() (e.g. "Discard unsaved amendment edits?")
  // so an unexpected dirty-draft prompt never hangs the recording.
  page.on('dialog', (dialog) => dialog.accept());

  // -- 1. Unlock.
  await page.goto('/ingest');
  await page.getByPlaceholder('Reviewer secret').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByPlaceholder('Reviewer secret').fill(manifest.reviewerSecret);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/Reviewing as/)).toBeVisible({ timeout: 15_000 });
  record('unlock', `Unlocked as reviewer "${manifest.reviewerDisplayName}".`);

  // -- 2. Browse the pending queue.
  await page.getByRole('tab', { name: 'Pending' }).click();
  // Assert the queue actually rendered a proposal, not just that the tab
  // click didn't throw -- the demo seeds 6 pending proposals, so at least
  // one "pending ..." queue entry must be visible.
  await expect(page.getByRole('button', { name: /^pending/ }).first()).toBeVisible({ timeout: 15_000 });
  record('inspect-queue', 'Opened the Pending queue tab.');

  // -- 3. Open the amend-target proposal directly and inspect provenance/verdicts.
  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.amend}`);
  await expect(page.getByText(`id ${manifest.proposals.amend}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Provenance/ }).click();
  await expect(page.getByText('Sources')).toBeVisible();
  await expect(page.getByText('Mutation hash:')).toBeVisible();
  record('inspect-provenance', `Inspected provenance and rail verdicts for proposal ${manifest.proposals.amend}.`);
  await page.getByRole('button', { name: 'Overview' }).click();

  // -- 4. Amend: edit the decision's rationale, save.
  await page.getByRole('button', { name: 'Edit / remove items' }).click();
  const rationaleField = page.getByLabel('rationale');
  await rationaleField.fill('Matches the reviewed design doc, amended during the Phase 2 demo.');
  await page.getByLabel('Amendment note (required)').fill('Tightening the rationale wording before acceptance.');
  await page.getByRole('button', { name: 'Save amendment' }).click();
  await expect(page.getByRole('button', { name: 'Edit / remove items' })).toBeVisible({ timeout: 15_000 });
  record('amend', `Amended proposal ${manifest.proposals.amend}'s rationale and saved.`);

  // -- 5. Accept it.
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByLabel('Review note (required)').fill('Looks correct after the amendment; approving.');
  await page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Proposal accepted.')).toBeVisible({ timeout: 15_000 });
  record('accept', `Accepted proposal ${manifest.proposals.amend} after amendment.`);

  // -- 6. Reject a different proposal with a reason.
  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.reject}`);
  await expect(page.getByText(`id ${manifest.proposals.reject}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason (required)').fill('Not credible enough to accept as-is.');
  await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('Proposal rejected.')).toBeVisible({ timeout: 15_000 });
  record('reject', `Rejected proposal ${manifest.proposals.reject} with a required reason.`);

  // -- 7. Surface a contradiction. The composition's contradiction detector
  // is a deliberate server-side no-op (contradiction-detector.ts), so no
  // genuinely *auto-detected* contradiction verdict can come from a real
  // write; this instead shows the real, storable `contradicts` edge
  // relationship a caller can legitimately declare, rendered in the
  // Provenance tab's "Evidence relationships" as a red badge.
  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.contradicts}`);
  await expect(page.getByText(`id ${manifest.proposals.contradicts}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Provenance/ }).click();
  await expect(page.getByText('Evidence relationships')).toBeVisible();
  await expect(page.getByText('contradicts', { exact: true })).toBeVisible();
  record(
    'contradiction',
    'Contradiction detection is a deliberate server-side no-op in this cohort (see contradiction-detector.ts); demonstrated instead via a real "contradicts" edge relationship rendered in the Provenance tab, on a proposal seeded specifically for this step.',
  );

  // -- 8. Stale conflict: accept the first, then observe the second go stale, and persist a refresh amendment.
  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.staleFirst}`);
  await expect(page.getByText(`id ${manifest.proposals.staleFirst}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByLabel('Review note (required)').fill('Accepting the first of the two conflicting proposals.');
  await page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Proposal accepted.')).toBeVisible({ timeout: 15_000 });
  record('stale-conflict-setup', `Accepted proposal ${manifest.proposals.staleFirst}, advancing the shared namespace revision.`);

  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.staleSecond}`);
  await expect(page.getByText('target revision is stale')).toBeVisible({ timeout: 15_000 });
  record('stale-conflict-detected', `Opened proposal ${manifest.proposals.staleSecond} and observed the stale-conflict banner.`);
  await page.getByRole('button', { name: 'Create refresh amendment' }).click();
  await page.getByPlaceholder('Required note for this refresh amendment').fill('Refreshing against the current revision after the conflicting accept.');
  await page.getByRole('button', { name: 'Persist refresh amendment' }).click();
  record('stale-conflict-refresh', `Persisted a refresh amendment against proposal ${manifest.proposals.staleSecond}.`);

  // -- 9. History + revert on the earlier accepted proposal.
  await page.goto(`/ingest?tab=pending&proposal=${manifest.proposals.historyRevert}`);
  await expect(page.getByText(`id ${manifest.proposals.historyRevert}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByLabel('Review note (required)').fill('Approving for the history/revert walkthrough.');
  await page.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Proposal accepted.')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'History' }).click();
  // Assert the accepted event's own note rather than the word "accepted" --
  // that word is ambiguous (it's also the queue's status-filter tab and the
  // proposal's status badge, both visible at the same time).
  await expect(page.getByText('Approving for the history/revert walkthrough.')).toBeVisible({ timeout: 15_000 });
  record('history', `Accepted proposal ${manifest.proposals.historyRevert} and followed its event history.`);

  await page.getByRole('button', { name: /Revert revision/ }).click();
  await page.getByLabel('Reason (required)').fill('Reverting as part of the Phase 2 demo walkthrough.');
  await page.getByRole('dialog').getByRole('button', { name: 'Revert' }).click();
  await expect(page.getByText(/Reverted/)).toBeVisible({ timeout: 15_000 });
  record('revert', `Reverted proposal ${manifest.proposals.historyRevert} with an attributed reason.`);
});

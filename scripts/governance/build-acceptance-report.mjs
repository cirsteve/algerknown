#!/usr/bin/env node
/**
 * Aggregates every evidence/*.json file left by the phase-2 acceptance
 * suites into one machine-readable report, and is itself the "meta-test":
 * it exits nonzero (failing `npm run test:phase2` and CI) unless every
 * required check in acceptance-manifest.mjs has passing evidence for every
 * one of its required cases. A missing, failed, or partially-cased check is
 * exactly as fatal as an outright failing test -- there is no "skipped".
 *
 * Run as the last step of `npm run test:phase2`, after every acceptance
 * suite (rails/conformance/boundary/recovery) has already run to completion
 * in its own process, so every evidence file on disk reflects a finished
 * suite, never a partially-written one from a suite still in progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CHECKS } from './acceptance-manifest.mjs';
import { evidenceDir, repoRoot } from './evidence.mjs';

const REPO_ROOT = repoRoot();
const EVIDENCE_DIR = evidenceDir();
const OUT_DIR = path.join(REPO_ROOT, 'build', 'phase2-acceptance');

function readEvidence(checkId) {
  const file = path.join(EVIDENCE_DIR, `${checkId}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

function uniqueJoin(values) {
  const set = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
  return set.length > 0 ? set.join(', ') : null;
}

function buildRecord(check) {
  const requiredCases = check.requiredCases ?? ['default'];
  const evidence = readEvidence(check.id);
  const evidenceFile = path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, `${check.id}.json`));

  if (!evidence || !Array.isArray(evidence.cases) || evidence.cases.length === 0) {
    return {
      checkId: check.id,
      title: check.title,
      kind: check.kind,
      status: 'missing',
      suite: null,
      fixture: null,
      backend: null,
      evidenceFile: null,
      durationMs: null,
      missingCases: requiredCases,
      cases: [],
    };
  }

  const casesById = new Map(evidence.cases.map((c) => [c.caseId, c]));
  const missingCases = requiredCases.filter((id) => !casesById.has(id));
  const failedCases = evidence.cases.filter((c) => c.status !== 'pass');
  const status = missingCases.length > 0 ? 'missing' : failedCases.length > 0 ? 'failed' : 'pass';

  return {
    checkId: check.id,
    title: check.title,
    kind: check.kind,
    status,
    suite: uniqueJoin(evidence.cases.map((c) => c.suite)),
    fixture: uniqueJoin(evidence.cases.map((c) => c.fixture)),
    backend: uniqueJoin(evidence.cases.map((c) => c.backend)),
    evidenceFile,
    durationMs: evidence.cases.reduce((sum, c) => sum + (c.durationMs ?? 0), 0),
    missingCases,
    cases: evidence.cases,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Phase 2 governance acceptance report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`Overall status: **${report.overallStatus.toUpperCase()}** (${report.passingChecks}/${report.requiredChecks} required checks passing)`);
  lines.push('');
  lines.push('| Check | Kind | Status | Suite | Backend / Channel | Duration (ms) | Evidence |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of report.records) {
    const label = r.status === 'missing' && r.missingCases?.length ? `${r.status} (missing: ${r.missingCases.join(', ')})` : r.status;
    lines.push(`| \`${r.checkId}\` — ${r.title} | ${r.kind} | ${label} | ${r.suite ?? '—'} | ${r.backend ?? '—'} | ${r.durationMs ?? '—'} | ${r.evidenceFile ?? '—'} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

function main() {
  const records = REQUIRED_CHECKS.map(buildRecord);
  const passingChecks = records.filter((r) => r.status === 'pass').length;
  const overallStatus = passingChecks === records.length ? 'pass' : 'fail';

  const report = {
    generatedAt: new Date().toISOString(),
    overallStatus,
    requiredChecks: records.length,
    passingChecks,
    records,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), renderMarkdown(report));

  console.log(`phase2 acceptance report: ${overallStatus} (${passingChecks}/${records.length} required checks passing)`);
  for (const r of records) {
    if (r.status !== 'pass') {
      const suffix = r.missingCases?.length ? ` -- missing case(s): ${r.missingCases.join(', ')}` : '';
      console.error(`  [${r.status}] ${r.checkId} -- ${r.title}${suffix}`);
    }
  }
  console.log(`report written to ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'report.json'))} and report.md`);

  if (overallStatus !== 'pass') {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

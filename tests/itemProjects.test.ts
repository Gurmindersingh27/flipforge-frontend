import assert from 'node:assert/strict';
import test from 'node:test';
import { isItemProject, isItemProjectList, projectHeadline, projectMissing, projectRange } from '../src/lib/itemProjects.ts';
import type { OutcomeExplanation } from '../src/lib/types.ts';

const saved = { id: 3, root_item_id: 1, schema_version: 1, inputs: {}, analysis_result: {} };
const summary = { root_item_id: 1, latest_version: saved, version_count: 1, stage: 'considering', calculated: null, updated_at: '2026-11-07T12:00:00Z' };
const page = () => ({ items: [structuredClone(summary)], limit: 20, offset: 0, next_offset: null });
const project = () => ({ summary: structuredClone(summary), versions: [structuredClone(saved)], latest_outcome: null, comparison: null, comparison_unavailable_reason: 'No outcome recorded' });

test('project ranges preserve cents, zero, losses and missing endpoints', () => {
  assert.equal(projectRange(90.5, 150.5), '$90.50 to $150.50');
  assert.equal(projectRange(-60, -60), '-$60.00');
  assert.equal(projectRange(0, 0), '$0.00');
  assert.equal(projectRange(null, 100), 'Not available');
  assert.equal(projectRange(undefined, 0, 'Not recorded'), 'Not recorded');
});
test('missing actual labels distinguish an unrecorded sale from zero costs', () => {
  assert.equal(projectMissing(['status', 'materials', 'hours']), 'sale not recorded; materials not recorded; your hours not recorded');
});
test('headline copy fixes time grammar without inventing or reranking a cause', () => {
  const explanation = { headline: null } as OutcomeExplanation;
  assert.equal(projectHeadline(explanation), null);
  explanation.headline = 'Most of the gap came from value of your time.';
  assert.equal(projectHeadline(explanation), 'Most of the gap came from the value of your time.');
  explanation.headline = 'Most of the gap came from selling $20.00 under the low estimate.';
  assert.equal(projectHeadline(explanation), explanation.headline);
});
test('project pages reject duplicate roots, malformed pagination and foreign latest versions', () => {
  assert.ok(isItemProjectList(page(), 20, 0));
  for (const change of [{ next_offset: 1 }, { offset: 20 }, { limit: 10 }, { items: [summary, summary] }]) assert.equal(isItemProjectList({ ...page(), ...change }, 20, 0), false);
  const foreign = page(); foreign.items[0].latest_version.root_item_id = 2;
  assert.equal(isItemProjectList(foreign, 20, 0), false);
});
test('project reads enforce the requested root, complete version set and outcome stage', () => {
  assert.ok(isItemProject(project(), 1));
  assert.equal(isItemProject(project(), 2), false);
  for (const mutate of [(p: ReturnType<typeof project>) => { p.versions = []; }, p => { p.summary.version_count = 2; }, p => { p.summary.stage = 'sold'; }, p => { p.comparison_unavailable_reason = ''; }, p => { p.versions[0].root_item_id = 2; }]) {
    const value = project(); mutate(value); assert.equal(isItemProject(value, 1), false);
  }
});

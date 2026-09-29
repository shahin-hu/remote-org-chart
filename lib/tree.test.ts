import { test, expect } from 'vitest';
import { buildForest } from './tree';
import type { Person } from './types';

const p = (id: string, managerId: string | null, extra: Partial<Person> = {}): Person => ({
  id, name: id.toUpperCase(), jobTitle: null, department: null, status: 'active', country: null,
  managerId, managerName: null, ...extra,
});

test('happy path: one root, correct depth and subtree sizes', () => {
  const { roots, diagnostics } = buildForest([
    p('ceo', null), p('vp', 'ceo'), p('eng1', 'vp'), p('eng2', 'vp'),
  ]);
  expect(roots).toHaveLength(1);
  expect(roots[0].id).toBe('ceo');
  expect(roots[0].subtreeSize).toBe(4);
  expect(roots[0].children[0].depth).toBe(1);
  expect(roots[0].children[0].subtreeSize).toBe(3);
  expect(diagnostics.placed, 'every person appears exactly once').toBe(4);
});

test('multiple roots are all returned, largest subtree first', () => {
  // Names chosen so size order and alphabetical order DISAGREE. An earlier
  // version of this test used 'ceo' and 'solo', where both rules give the same
  // answer, so it passed even when the sort was alphabetical. A test that cannot
  // distinguish the rule it is checking from a different rule is not a test.
  const { roots, diagnostics } = buildForest([
    p('alice', null),                                  // alphabetically first, team of 1
    p('zara', null), p('bob', 'zara'), p('carol', 'zara'), // alphabetically last, team of 3
  ]);
  expect(roots).toHaveLength(2);
  expect(roots[0].id, 'bigger team sorts first, not alphabetically').toBe('zara');
  expect(roots[1].id).toBe('alice');
  expect(diagnostics.roots.map((r) => r.reason)).toEqual(['no_manager', 'no_manager']);
});

test('direct reports are listed alphabetically, whatever order they arrive in', () => {
  // Inserted deliberately out of order. Without a stable sort the chart would
  // reshuffle between renders, which is worse than being in the wrong order.
  const { roots } = buildForest([
    p('boss', null), p('zoe', 'boss'), p('adam', 'boss'), p('mia', 'boss'),
  ]);
  expect(roots[0].children.map((c) => c.name)).toEqual(['ADAM', 'MIA', 'ZOE']);
});

test('orphan: manager id points outside the set, person stays visible', () => {
  const { roots, diagnostics } = buildForest([p('ceo', null), p('ghost', 'missing-id')]);
  expect(roots, 'the orphan is surfaced, not dropped').toHaveLength(2);
  expect(diagnostics.orphans).toEqual([
    { id: 'ghost', name: 'GHOST', missingManagerId: 'missing-id' },
  ]);
  expect(diagnostics.roots.find((r) => r.id === 'ghost')?.reason).toBe('orphaned');
});

test('two-node cycle is broken and reported, render terminates', () => {
  const { roots, diagnostics } = buildForest([p('a', 'b'), p('b', 'a')]);
  expect(diagnostics.cycles).toHaveLength(1);
  expect(diagnostics.cycles[0]).toHaveLength(2);
  expect(diagnostics.placed, 'both people still appear').toBe(2);
  expect(roots, 'exactly one edge was cut').toHaveLength(1);
});

test('self-reference is treated as a one-node cycle', () => {
  const { diagnostics } = buildForest([p('a', 'a')]);
  expect(diagnostics.cycles).toEqual([['a']]);
  expect(diagnostics.roots[0].reason).toBe('cycle_broken');
});

test('longer cycle with a tail attached does not lose the tail', () => {
  // c -> a -> b -> a   (a and b loop; c hangs off a)
  const { diagnostics } = buildForest([p('a', 'b'), p('b', 'a'), p('c', 'a')]);
  expect(diagnostics.cycles).toHaveLength(1);
  expect(diagnostics.placed, 'the tail is still placed').toBe(3);
});

test('manager named but not on Remote is recorded, not silently dropped', () => {
  const { diagnostics } = buildForest([p('x', null, { managerName: 'Jane External' })]);
  expect(diagnostics.managersNotInRemote).toEqual([
    { id: 'x', name: 'X', managerName: 'Jane External' },
  ]);
  expect(diagnostics.roots[0].reason).toBe('no_manager');
});

test('empty input does not throw', () => {
  const { roots, diagnostics } = buildForest([]);
  expect(roots).toEqual([]);
  expect(diagnostics.total).toBe(0);
});

test('deep chain does not blow the stack', () => {
  const n = 20000;
  const people: Person[] = [p('r', null)];
  for (let i = 0; i < n; i++) people.push(p(`n${i}`, i === 0 ? 'r' : `n${i - 1}`));
  const { roots, diagnostics } = buildForest(people);
  expect(diagnostics.placed).toBe(n + 1);
  expect(roots[0].subtreeSize).toBe(n + 1);
});

test('invariant: placed always equals total, whatever the data', () => {
  const messy: Person[] = [
    p('ceo', null), p('a', 'ceo'), p('b', 'a'),
    p('x', 'y'), p('y', 'x'),   // cycle
    p('z', 'nope'),             // orphan
    p('s', 's'),                // self-reference
    p('lone', null),
  ];
  const { diagnostics } = buildForest(messy);
  expect(diagnostics.placed, 'nobody disappears, ever').toBe(messy.length);
});

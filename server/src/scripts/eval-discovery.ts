import fs from 'node:fs';
import path from 'node:path';
import type { RequirementDraft, RequirementIssue, Story } from '@riccon-scrum/shared';
import { validateRequirementDraft } from '../discovery';

interface EvalCase {
  name: string;
  description: string;
  existingTitles?: string[];
  historicalTitles?: string[];
  dodCommandCount?: number;
  requireMachineDod?: boolean;
  expectNoErrors?: boolean;
  expectErrorCodes?: string[];
  draft: RequirementDraft | null;
}

function existingStory(title: string): Story {
  return {
    id: `eval-${title}`,
    projectId: 'eval',
    title,
    description: '',
    acceptanceCriteria: '',
    status: 'draft',
    branch: null,
    worktreePath: null,
    requirementId: null,
    categoryId: null,
    bugId: null,
    sourceStoryId: null,
    changeRequestId: null,
    sourceVersion: null,
    sourceVersionId: null,
    sourceStoryKey: null,
    sourceClause: null,
    createdAt: '',
    updatedAt: '',
  };
}

const dir = path.resolve(import.meta.dirname, '../../../evals/discovery/cases');
const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
const cases = files.map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as EvalCase);

let totalStories = 0;
let totalAcs = 0;
let totalGwt = 0;
let totalTests = 0;
let totalClauses = 0;
let schemaValid = 0;
let passed = 0;
const rows: string[] = [];

for (const testCase of cases) {
  const issues: RequirementIssue[] = validateRequirementDraft(testCase.draft, {
    existingStories: (testCase.existingTitles ?? []).map(existingStory),
    historicalTitles: testCase.historicalTitles ?? [],
    requireMachineDod: testCase.requireMachineDod ?? true,
    dodCommandCount: testCase.dodCommandCount ?? 1,
  });
  const errors = [...new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code))];
  const expected = [...new Set(testCase.expectErrorCodes ?? [])];
  const ok = testCase.expectNoErrors ? errors.length === 0 : errors.length === expected.length && expected.every((code) => errors.includes(code));
  if (testCase.draft) schemaValid++;
  const stories = testCase.draft?.stories ?? [];
  const acs = stories.flatMap((story) => story.acceptance);
  totalStories += stories.length;
  totalAcs += acs.length;
  totalGwt += acs.filter((ac) => ac.given.trim() && ac.when.trim() && ac.then.trim()).length;
  totalTests += acs.filter((ac) => (ac.test ?? '').trim()).length;
  totalClauses += stories.filter((story) => story.clauses.length > 0).length;
  if (ok) passed++;
  rows.push(
    `${ok ? 'PASS' : 'FAIL'} ${testCase.name.padEnd(24)} errors=[${errors.join(',')}] expected=[${expected.join(',')}] stories=${stories.length}`,
  );
}

console.log(rows.join('\n'));
console.log('');
console.log('metric,schemaRate,gwtRate,testMappingRate,clauseRate,avgStories,expectationPassRate');
console.log(
  [
    'value',
    `${cases.length ? schemaValid / cases.length : 0}`,
    `${totalAcs ? totalGwt / totalAcs : 0}`,
    `${totalAcs ? totalTests / totalAcs : 0}`,
    `${totalStories ? totalClauses / totalStories : 0}`,
    `${cases.length ? totalStories / cases.length : 0}`,
    `${cases.length ? passed / cases.length : 0}`,
  ].join(','),
);

const failed = cases.length - passed;
if (failed > 0) {
  console.error(`\n${failed} eval case(s) failed`);
  process.exit(1);
}
console.log('\nDISCOVERY_EVAL_OK');

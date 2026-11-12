import type { RequirementDraft, Story } from '@riccon-scrum/shared';
import { validateRequirementDraft } from '../discovery';

function existingStory(title: string): Story {
  return {
    id: 'existing',
    projectId: 'project',
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

function draftWith(title: string, given = '前提'): RequirementDraft {
  return {
    summary: '测试需求',
    goals: ['可衡量目标'],
    nonGoals: [],
    personas: [],
    assumptions: [],
    openQuestions: [],
    stories: [
      {
        key: 'R1-S1',
        title,
        persona: '用户',
        value: '完成任务',
        description: '描述',
        acceptance: [{ id: 'AC1', given, when: '动作', then: '可观察结果', test: 'AC1 验收用例' }],
        dod: ['test: npm test'],
        size: 'S',
        dependsOn: [],
        clauses: ['R1.1'],
        outOfScope: [],
      },
    ],
  };
}

function expect(cond: boolean, message: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${message}`);
  console.log(`OK ${message}`);
}

const options = {
  existingStories: [existingStory('除数为 0 时 divide 返回 null 并有测试保护')],
  historicalTitles: ['新增除法能力'],
  requireMachineDod: true,
  dodCommandCount: 1,
};

const duplicate = validateRequirementDraft(draftWith('除数为 0 时 divide 返回 null 并有测试保护'), options);
expect(
  duplicate.some((i) => i.code === 'story-title-existing' && i.severity === 'error'),
  '高度相似的现有故事被判定为 error',
);

const brokenGwt = validateRequirementDraft(draftWith('全新的故事标题', ''), options);
expect(brokenGwt.some((i) => i.code === 'ac-gwt' && i.severity === 'error'), '缺少 Given 的验收标准被判定为 error');

const schema = validateRequirementDraft(null, options);
expect(schema.some((i) => i.code === 'schema' && i.severity === 'error'), '不可解析草稿被判定为 schema error');

const tooFew = validateRequirementDraft(draftWith('全新的故事标题'), options);
expect(tooFew.some((i) => i.code === 'stories-min' && i.severity === 'error'), '少于 3 个故事被判定为 DoR error');

const historical = validateRequirementDraft(draftWith('新增除法能力'), options);
expect(
  historical.some((i) => i.code === 'story-title-history' && i.severity === 'error'),
  '与历史需求故事重复被判定为 error',
);

const noTestDraft = draftWith('另一个全新故事标题');
delete noTestDraft.stories[0].acceptance[0].test;
const noTest = validateRequirementDraft(noTestDraft, options);
expect(noTest.some((i) => i.code === 'ac-test' && i.severity === 'error'), '缺少 AC 测试映射被判定为 error');

console.log('DISCOVERY_CHECK_OK');

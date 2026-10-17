import { describe, expect, it } from 'vitest';
import {
  AnswerQuestionRequest,
  ApprovalDecisionRequest,
  BudgetSettingsRequest,
  ConnectRequest,
  CreateChatRequest,
  CreateScheduleRequest,
  CreateTaskRequest,
  SendChatMessageRequest,
  UpdateChatRequest,
  isIanaTimezone,
} from '../src';

const UUID = '3f2b8c1e-4d5a-4b6c-9e7f-1a2b3c4d5e6f';

describe('isIanaTimezone', () => {
  it.each(['UTC', 'America/Toronto', 'Europe/London', 'America/Argentina/Buenos_Aires'])('accepts %s', (tz) => {
    expect(isIanaTimezone(tz)).toBe(true);
  });
  it.each(['', 'Mars/Olympus', 'America/Toronto; DROP', '../etc', '+05:00'])('rejects %j', (tz) => {
    expect(isIanaTimezone(tz)).toBe(false);
  });
});

describe('CreateTaskRequest', () => {
  it('trims the prompt, lowercases domains and defaults allowedDomains', () => {
    expect(CreateTaskRequest.parse({ prompt: '  do it  ' })).toEqual({ prompt: 'do it', allowedDomains: [] });
    expect(CreateTaskRequest.parse({ prompt: 'x', allowedDomains: [' Example.COM ', '*.wikipedia.org'] }).allowedDomains).toEqual(['example.com', '*.wikipedia.org']);
  });

  it('rejects blank or oversized prompts', () => {
    expect(CreateTaskRequest.safeParse({ prompt: '   ' }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ prompt: 'a'.repeat(8001) }).success).toBe(false);
  });

  it.each(['localhost', 'http://example.com', 'example.com/path', '*example.com', 'exa mple.com'])('rejects domain %j', (d) => {
    expect(CreateTaskRequest.safeParse({ prompt: 'x', allowedDomains: [d] }).success).toBe(false);
  });

  it('caps allowedDomains at 20 and validates timezone and idempotency key', () => {
    expect(CreateTaskRequest.safeParse({ prompt: 'x', allowedDomains: Array.from({ length: 21 }, (_, i) => `d${i}.com`) }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ prompt: 'x', timezone: 'Not/AZone' }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ prompt: 'x', idempotencyKey: 'short' }).success).toBe(false);
    expect(CreateTaskRequest.safeParse({ prompt: 'x', timezone: 'America/Toronto', idempotencyKey: 'abcdefgh' }).success).toBe(true);
  });
});

describe('ApprovalDecisionRequest', () => {
  const valid = { decision: 'approved', argsHash: 'a'.repeat(64), nonce: 'n'.repeat(16) };
  it('accepts a well-formed decision', () => {
    expect(ApprovalDecisionRequest.safeParse(valid).success).toBe(true);
  });
  it.each([
    ['unknown decision', { decision: 'maybe' }],
    ['uppercase hash', { argsHash: 'A'.repeat(64) }],
    ['short hash', { argsHash: 'a'.repeat(63) }],
    ['short nonce', { nonce: 'n'.repeat(15) }],
  ])('rejects %s', (_label, patch) => {
    expect(ApprovalDecisionRequest.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('CreateScheduleRequest', () => {
  const base = { name: 'Daily digest', prompt: 'summarise', timezone: 'UTC' };
  it('accepts cron and interval specs and applies defaults', () => {
    const cron = CreateScheduleRequest.parse({ ...base, spec: { kind: 'cron', cron: '0 9 * * 1-5' } });
    expect(cron.catchupWindowMinutes).toBe(10);
    expect(cron.allowedDomains).toEqual([]);
    expect(CreateScheduleRequest.safeParse({ ...base, spec: { kind: 'interval', everyMinutes: 60 } }).success).toBe(true);
  });
  it('rejects too-frequent intervals, short crons, unknown kinds and missing timezones', () => {
    expect(CreateScheduleRequest.safeParse({ ...base, spec: { kind: 'interval', everyMinutes: 4 } }).success).toBe(false);
    expect(CreateScheduleRequest.safeParse({ ...base, spec: { kind: 'cron', cron: '* * * *' } }).success).toBe(false);
    expect(CreateScheduleRequest.safeParse({ ...base, spec: { kind: 'once' } }).success).toBe(false);
    expect(CreateScheduleRequest.safeParse({ ...base, timezone: '', spec: { kind: 'interval', everyMinutes: 60 } }).success).toBe(false);
  });
});

describe('chat requests', () => {
  it('CreateChatRequest and UpdateChatRequest reject unknown fields', () => {
    expect(CreateChatRequest.safeParse({ title: 'x' }).success).toBe(true);
    expect(CreateChatRequest.safeParse({ title: 'x', ownerId: 'u' }).success).toBe(false);
    expect(UpdateChatRequest.safeParse({ pinned: true, archived: false }).success).toBe(true);
    expect(UpdateChatRequest.safeParse({ title: '' }).success).toBe(false);
    expect(UpdateChatRequest.safeParse({ ownerId: 'u' }).success).toBe(false);
  });

  it('SendChatMessageRequest defaults fileIds and requires UUIDs', () => {
    expect(SendChatMessageRequest.parse({ text: 'hi' }).fileIds).toEqual([]);
    expect(SendChatMessageRequest.safeParse({ text: 'hi', fileIds: [UUID] }).success).toBe(true);
    expect(SendChatMessageRequest.safeParse({ text: 'hi', fileIds: ['not-a-uuid'] }).success).toBe(false);
    expect(SendChatMessageRequest.safeParse({ text: '  ' }).success).toBe(false);
  });

  it('AnswerQuestionRequest needs a choice or a typed answer', () => {
    expect(AnswerQuestionRequest.safeParse({ questionId: UUID, choices: ['yes'] }).success).toBe(true);
    expect(AnswerQuestionRequest.safeParse({ questionId: UUID, text: 'because' }).success).toBe(true);
    const empty = AnswerQuestionRequest.safeParse({ questionId: UUID, text: '   ' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe('pick an option or type an answer');
  });
});

describe('ConnectRequest / BudgetSettingsRequest', () => {
  it('only accepts curated toolkits', () => {
    expect(ConnectRequest.safeParse({ toolkit: 'gmail' }).success).toBe(true);
    expect(ConnectRequest.safeParse({ toolkit: 'dropbox' }).success).toBe(false);
  });

  it('accepts non-negative USD strings with up to 6 decimals', () => {
    expect(BudgetSettingsRequest.safeParse({ maxCostPerRunUsd: '0.5', monthlyLimitUsd: '20' }).success).toBe(true);
    expect(BudgetSettingsRequest.safeParse({ maxCostPerRunUsd: '-1', monthlyLimitUsd: '20' }).success).toBe(false);
    expect(BudgetSettingsRequest.safeParse({ maxCostPerRunUsd: '0.1234567', monthlyLimitUsd: '20' }).success).toBe(false);
  });
});

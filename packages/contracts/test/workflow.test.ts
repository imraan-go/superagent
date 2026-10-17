import { describe, expect, it } from 'vitest';
import { scheduleTemporalId, taskWorkflowId } from '../src/workflow';

describe('workflow ids', () => {
  it('prefixes task and schedule ids so they cannot collide in Temporal', () => {
    expect(taskWorkflowId('abc')).toBe('task-abc');
    expect(scheduleTemporalId('abc')).toBe('sched-abc');
    expect(taskWorkflowId('abc')).not.toBe(scheduleTemporalId('abc'));
  });
});

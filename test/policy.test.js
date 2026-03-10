import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SafetyPolicy,
  loadPolicyConfig,
  supportsFormElicitation,
} from '../dist/policy.js';

test('loadPolicyConfig uses trusted-local defaults', () => {
  assert.deepEqual(loadPolicyConfig({}), {
    allowWrites: true,
    allowDestructiveDeletes: false,
  });
});

test('supportsFormElicitation handles explicit and implicit form support', () => {
  assert.equal(supportsFormElicitation(undefined), false);
  assert.equal(supportsFormElicitation({ elicitation: {} }), true);
  assert.equal(
    supportsFormElicitation({ elicitation: { modes: ['url'] } }),
    false
  );
});

test('SafetyPolicy blocks writes when disabled', () => {
  const policy = new SafetyPolicy({
    allowWrites: false,
    allowDestructiveDeletes: false,
  });

  assert.throws(() => policy.assertWriteAllowed(), /Write operations are disabled/);
});

test('SafetyPolicy blocks delete without policy override or elicitation', async () => {
  const policy = new SafetyPolicy({
    allowWrites: true,
    allowDestructiveDeletes: false,
  });

  await assert.rejects(
    () =>
      policy.assertDeleteAllowed({
        clientCapabilities: undefined,
        confirm: async () => true,
        targetDescription: 'note "Draft"',
      }),
    /Delete operations are blocked by default/
  );
});

test('SafetyPolicy requires positive confirmation for delete', async () => {
  const policy = new SafetyPolicy({
    allowWrites: true,
    allowDestructiveDeletes: false,
  });

  await assert.rejects(
    () =>
      policy.assertDeleteAllowed({
        clientCapabilities: { elicitation: {} },
        confirm: async () => false,
        targetDescription: 'folder "Projects"',
      }),
    /Deletion cancelled/
  );

  await assert.doesNotReject(() =>
    policy.assertDeleteAllowed({
      clientCapabilities: { elicitation: {} },
      confirm: async () => true,
      targetDescription: 'folder "Projects"',
    })
  );
});

import type { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { NotesMcpError } from './errors.js';

export interface SafetyPolicyConfig {
  allowWrites: boolean;
  allowDestructiveDeletes: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadPolicyConfig(
  env: NodeJS.ProcessEnv = process.env
): SafetyPolicyConfig {
  return {
    allowWrites: parseBoolean(env.NOTES_MCP_ALLOW_WRITES, true),
    allowDestructiveDeletes: parseBoolean(env.NOTES_MCP_ALLOW_DELETES, false),
  };
}

export function supportsFormElicitation(
  capabilities: ClientCapabilities | undefined
): boolean {
  const elicitation = capabilities?.elicitation;
  if (!elicitation) {
    return false;
  }

  const modes = (elicitation as { modes?: string[] }).modes;
  return !modes || modes.length === 0 || modes.includes('form');
}

export class SafetyPolicy {
  constructor(private readonly config: SafetyPolicyConfig) {}

  get snapshot(): SafetyPolicyConfig {
    return { ...this.config };
  }

  assertWriteAllowed() {
    if (!this.config.allowWrites) {
      throw new NotesMcpError(
        'permission_denied',
        'Write operations are disabled. Restart with NOTES_MCP_ALLOW_WRITES=1 to enable changes.'
      );
    }
  }

  async assertDeleteAllowed(options: {
    clientCapabilities: ClientCapabilities | undefined;
    confirm: (message: string) => Promise<boolean>;
    targetDescription: string;
  }) {
    this.assertWriteAllowed();

    if (this.config.allowDestructiveDeletes) {
      return;
    }

    if (!supportsFormElicitation(options.clientCapabilities)) {
      throw new NotesMcpError(
        'unsafe_operation',
        'Delete operations are blocked by default. Restart with NOTES_MCP_ALLOW_DELETES=1 or use a client that supports MCP elicitation confirmations.'
      );
    }

    const confirmed = await options.confirm(
      `Confirm deletion of ${options.targetDescription}.`
    );
    if (!confirmed) {
      throw new NotesMcpError(
        'unsafe_operation',
        `Deletion cancelled for ${options.targetDescription}.`
      );
    }
  }
}

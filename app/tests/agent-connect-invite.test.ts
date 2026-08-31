import { describe, expect, it } from 'vitest';

import { buildAgentInvite, type PairingTicket } from '@/lib/agent-connect/invite';

const ticket: PairingTicket = {
  code: '0123456789abcdef0123456789abcdef',
  createdAt: Date.UTC(2026, 7, 29, 12),
  expiresAt: Date.UTC(2026, 7, 29, 12, 15),
  redeemed: false,
};

describe('VibeX agent invite', () => {
  it('is valid markdown, placeholder-free, and fixed to the VibeX LAN endpoint', () => {
    const invite = buildAgentInvite(ticket, '192.168.1.24');
    expect(invite).toContain('http://192.168.1.24:8791/pair');
    expect(invite).toContain('http://192.168.1.24:8791/mcp');
    expect(invite).toContain(ticket.code);
    expect(invite).toContain('same Wi-Fi');
    expect(invite).toContain('foreground');
    expect(invite).not.toMatch(/\\`|\{\{|<your|TODO|8790/);
    expect((invite.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it.each(['Hermes', 'Codex', 'Claude Code', 'OpenCode', 'Generic MCP / HTTP'])('contains a concrete %s setup block', (harness) => {
    const invite = buildAgentInvite(ticket, '10.0.0.8');
    expect(invite).toContain(`### ${harness}`);
    expect(invite).toMatch(new RegExp(`${harness}[\\s\\S]+Authorization: Bearer \\*\\*\\*`, 'i'));
  });

  it('names exactly the final tool set and delays hello until after project choice', () => {
    const invite = buildAgentInvite(ticket, '10.0.0.8');
    for (const name of ['list_projects', 'get_project', 'read_project_file', 'write_project_files', 'append_project_message']) {
      expect(invite).toContain(`\`${name}\``);
    }
    expect(invite).not.toContain('read_project_files');
    expect(invite).toMatch(/user chooses a project[\s\S]+append_project_message/i);
    expect(invite).toMatch(/one-line hello/i);
  });

  it('rejects non-LAN or syntactically unsafe hosts', () => {
    expect(() => buildAgentInvite(ticket, 'https://evil.example')).toThrow(/host/i);
    expect(() => buildAgentInvite(ticket, '192.168.1.2/path')).toThrow(/host/i);
  });
});

import { ChannelType, Collection, PermissionFlagsBits, type Guild, type Role, type TextChannel } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { createRepos, type Repos } from '../db/repos.js';
import {
  canAssignRole,
  DEFAULT_CHANNEL_NAME,
  DEFAULT_ROLE_NAME,
  findWelcomeChannel,
  resolveSetupChannel,
  resolveSetupRole,
  toggleParticipation,
} from './onboarding.js';

/* ------------------------------------------------------------------- fakes */

const ALL_PERMS = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles];

function permissions(granted: bigint[]) {
  return {
    has: (needed: bigint | bigint[]) =>
      (Array.isArray(needed) ? needed : [needed]).every((p) => granted.includes(p)),
  };
}

interface FakeOptions {
  botPermissions?: bigint[];
  botRolePosition?: number;
  channels?: { id: string; name: string; canView?: boolean; canSend?: boolean }[];
  roles?: { id: string; name: string; position: number }[];
  memberRoleIds?: string[];
  systemChannelId?: string;
}

let created: { channels: string[]; roles: string[] };
let roleChanges: { added: string[]; removed: string[] };

function fakeChannel(spec: { id: string; name: string; canView?: boolean; canSend?: boolean }): TextChannel {
  const granted: bigint[] = [];
  if (spec.canView !== false) granted.push(PermissionFlagsBits.ViewChannel);
  if (spec.canSend !== false) granted.push(PermissionFlagsBits.SendMessages);

  return {
    id: spec.id,
    name: spec.name,
    type: ChannelType.GuildText,
    rawPosition: 0,
    permissionsFor: () => permissions(granted),
  } as unknown as TextChannel;
}

function fakeRole(spec: { id: string; name: string; position: number }): Role {
  return {
    id: spec.id,
    name: spec.name,
    position: spec.position,
  } as unknown as Role;
}

function fakeGuild(options: FakeOptions = {}): Guild {
  const botPermissions = options.botPermissions ?? ALL_PERMS;
  const botRolePosition = options.botRolePosition ?? 100;

  const channelCache = new Collection<string, TextChannel>();
  for (const spec of options.channels ?? []) channelCache.set(spec.id, fakeChannel(spec));

  const roleCache = new Collection<string, Role>();
  for (const spec of options.roles ?? []) roleCache.set(spec.id, fakeRole(spec));

  const memberRoles = new Set(options.memberRoleIds ?? []);

  return {
    id: 'guild-1',
    systemChannel: options.systemChannelId ? channelCache.get(options.systemChannelId) : null,
    members: {
      me: {
        permissions: permissions(botPermissions),
        roles: {
          highest: { comparePositionTo: (role: Role) => botRolePosition - role.position },
        },
      },
      fetch: async () => ({
        roles: {
          cache: { has: (id: string) => memberRoles.has(id) },
          add: async (role: Role) => {
            roleChanges.added.push(role.id);
            memberRoles.add(role.id);
          },
          remove: async (role: Role) => {
            roleChanges.removed.push(role.id);
            memberRoles.delete(role.id);
          },
        },
      }),
    },
    channels: {
      cache: channelCache,
      create: async ({ name }: { name: string }) => {
        created.channels.push(name);
        return fakeChannel({ id: 'new-channel', name });
      },
    },
    roles: {
      cache: roleCache,
      fetch: async (id: string) => roleCache.get(id) ?? null,
      create: async ({ name }: { name: string }) => {
        created.roles.push(name);
        // Discord places a new role at the bottom, below the bot's own.
        return fakeRole({ id: 'new-role', name, position: 0 });
      },
    },
  } as unknown as Guild;
}

beforeEach(() => {
  created = { channels: [], roles: [] };
  roleChanges = { added: [], removed: [] };
});

/* -------------------------------------------------------------------- tests */

describe('resolveSetupChannel', () => {
  it('creates #pickems when the server has none', async () => {
    const result = await resolveSetupChannel(fakeGuild(), null);

    expect(result.ok && result.action).toBe('created');
    expect(created.channels).toEqual([DEFAULT_CHANNEL_NAME]);
  });

  it('reuses an existing #pickems rather than making a second one', async () => {
    const guild = fakeGuild({ channels: [{ id: 'c1', name: DEFAULT_CHANNEL_NAME }] });
    const result = await resolveSetupChannel(guild, null);

    expect(result.ok && result.action).toBe('reused');
    expect(created.channels).toEqual([]);
  });

  it('uses a channel the admin named', async () => {
    const provided = fakeChannel({ id: 'c9', name: 'general' });
    const result = await resolveSetupChannel(fakeGuild(), provided);

    expect(result.ok && result.action).toBe('provided');
    expect(result.ok && result.value.id).toBe('c9');
  });

  it('explains what to do when it cannot create a channel', async () => {
    const guild = fakeGuild({ botPermissions: [PermissionFlagsBits.ManageRoles] });
    const result = await resolveSetupChannel(guild, null);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Manage Channels');
      expect(result.reason).toContain('/setup channel:#your-channel');
    }
  });

  it('refuses a named channel it cannot post in, rather than failing silently every Tuesday', async () => {
    const provided = fakeChannel({ id: 'c9', name: 'locked', canSend: false });
    const result = await resolveSetupChannel(fakeGuild(), provided);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Send Messages');
  });

  it('refuses a named channel it cannot even see', async () => {
    const provided = fakeChannel({ id: 'c9', name: 'hidden', canView: false });
    const result = await resolveSetupChannel(fakeGuild(), provided);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('View Channel');
  });
});

describe('resolveSetupRole', () => {
  it('creates @Pickems when the server has none', async () => {
    const result = await resolveSetupRole(fakeGuild(), null);

    expect(result.ok && result.action).toBe('created');
    expect(created.roles).toEqual([DEFAULT_ROLE_NAME]);
  });

  it('reuses an existing @Pickems', async () => {
    const guild = fakeGuild({ roles: [{ id: 'r1', name: DEFAULT_ROLE_NAME, position: 1 }] });
    const result = await resolveSetupRole(guild, null);

    expect(result.ok && result.action).toBe('reused');
    expect(created.roles).toEqual([]);
  });

  it('accepts an existing role even without Manage Roles, warning instead of blocking', async () => {
    // Whoever installs the bot may not be able to grant Manage Roles. The game
    // only needs to READ who holds the role, so setup must still succeed —
    // losing /join is a downgrade, not a blocker.
    const guild = fakeGuild({
      botPermissions: [PermissionFlagsBits.ManageChannels],
      roles: [{ id: 'r1', name: 'Players', position: 1 }],
    });
    const result = await resolveSetupRole(guild, fakeRole({ id: 'r1', name: 'Players', position: 1 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toContain('by hand');
      expect(result.warning).toContain('Everything else works');
    }
  });

  it('accepts a role positioned above the bot, warning that /join will not work', async () => {
    const guild = fakeGuild({ botRolePosition: 5 });
    const result = await resolveSetupRole(guild, fakeRole({ id: 'r9', name: 'Admins', position: 50 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toContain('above my own role');
      expect(result.warning).toContain('Server Settings');
    }
  });

  it('reports no warning when the bot can assign the role', async () => {
    const guild = fakeGuild({ roles: [{ id: 'r1', name: DEFAULT_ROLE_NAME, position: 1 }] });
    const result = await resolveSetupRole(guild, null);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBeUndefined();
  });

  it('still refuses to CREATE a role without Manage Roles, since that genuinely cannot work', async () => {
    const guild = fakeGuild({ botPermissions: [PermissionFlagsBits.ManageChannels] });
    const result = await resolveSetupRole(guild, null);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Manage Roles');
      expect(result.reason).toContain('/setup role:@your-role');
    }
  });
});

describe('canAssignRole', () => {
  it('is true with the permission and a lower role', () => {
    const guild = fakeGuild({ botRolePosition: 100 });
    expect(canAssignRole(guild, fakeRole({ id: 'r1', name: 'P', position: 1 }))).toBe(true);
  });

  it('is false without Manage Roles', () => {
    const guild = fakeGuild({ botPermissions: [] });
    expect(canAssignRole(guild, fakeRole({ id: 'r1', name: 'P', position: 1 }))).toBe(false);
  });

  it('is false when the role outranks the bot', () => {
    const guild = fakeGuild({ botRolePosition: 5 });
    expect(canAssignRole(guild, fakeRole({ id: 'r1', name: 'P', position: 50 }))).toBe(false);
  });
});

describe('toggleParticipation', () => {
  const roles = [{ id: 'r1', name: DEFAULT_ROLE_NAME, position: 1 }];

  it('adds the role for a player joining', async () => {
    const message = await toggleParticipation(fakeGuild({ roles }), 'r1', 'u1');

    expect(roleChanges.added).toEqual(['r1']);
    expect(message).toContain('You are in');
  });

  it('removes the role for a player who already has it', async () => {
    const guild = fakeGuild({ roles, memberRoleIds: ['r1'] });
    const message = await toggleParticipation(guild, 'r1', 'u1');

    expect(roleChanges.removed).toEqual(['r1']);
    expect(message).toContain('left the pool');
  });

  it('says results are kept when leaving, since standings still include them', async () => {
    const guild = fakeGuild({ roles, memberRoleIds: ['r1'] });
    expect(await toggleParticipation(guild, 'r1', 'u1')).toContain('results so far are kept');
  });

  it('is idempotent when /join is used by someone already in', async () => {
    const guild = fakeGuild({ roles, memberRoleIds: ['r1'] });
    const message = await toggleParticipation(guild, 'r1', 'u1', 'join');

    expect(roleChanges.added).toEqual([]);
    expect(message).toContain('already in the pool');
  });

  it('is idempotent when /leave is used by someone not in', async () => {
    const message = await toggleParticipation(fakeGuild({ roles }), 'r1', 'u1', 'leave');

    expect(roleChanges.removed).toEqual([]);
    expect(message).toContain('nothing to leave');
  });

  it('reports a deleted role instead of throwing', async () => {
    const message = await toggleParticipation(fakeGuild(), 'gone', 'u1');
    expect(message).toContain('has been deleted');
  });

  it('reports a role it cannot reach because of hierarchy', async () => {
    const guild = fakeGuild({ roles: [{ id: 'r1', name: 'Above', position: 500 }], botRolePosition: 5 });
    const message = await toggleParticipation(guild, 'r1', 'u1');
    expect(message).toContain('above my own role');
  });
});

describe('findWelcomeChannel', () => {
  it('prefers the system channel', () => {
    const guild = fakeGuild({
      channels: [
        { id: 'c1', name: 'general' },
        { id: 'c2', name: 'system' },
      ],
      systemChannelId: 'c2',
    });
    expect(findWelcomeChannel(guild)?.id).toBe('c2');
  });

  it('falls back to the first channel it can post in', () => {
    const guild = fakeGuild({
      channels: [
        { id: 'c1', name: 'locked', canSend: false },
        { id: 'c2', name: 'general' },
      ],
    });
    expect(findWelcomeChannel(guild)?.id).toBe('c2');
  });

  it('returns null when there is nowhere to post', () => {
    const guild = fakeGuild({ channels: [{ id: 'c1', name: 'locked', canSend: false }] });
    expect(findWelcomeChannel(guild)).toBeNull();
  });
});

describe('participation storage', () => {
  let repos: Repos;

  beforeEach(() => {
    repos = createRepos(openDatabase(':memory:'));
  });

  it('setup is re-runnable and just updates the stored configuration', () => {
    repos.guilds.upsert({ guildId: 'g', channelId: 'c1', roleId: 'r1', timezone: 'America/Chicago' });
    repos.guilds.upsert({ guildId: 'g', channelId: 'c2', roleId: 'r2', timezone: 'America/Denver' });

    expect(repos.guilds.listActive()).toHaveLength(1);
    expect(repos.guilds.get('g')).toMatchObject({ channelId: 'c2', roleId: 'r2', timezone: 'America/Denver' });
  });
});

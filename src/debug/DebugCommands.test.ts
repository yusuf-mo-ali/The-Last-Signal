import { describe, expect, it, vi } from 'vitest';
import { DebugCommands } from './DebugCommands';

describe('DebugCommands', () => {
  it('registers and runs working commands with arguments', () => {
    const commands = new DebugCommands(vi.fn());
    commands.register('add', 'Adds two numbers', (a: number, b: number) => a + b);
    expect(commands.has('add')).toBe(true);
    expect(commands.run('add', ...([2, 3] as never[]))).toBe(5);
  });

  it('rejects duplicate and invalid names, and the reserved "help"', () => {
    const commands = new DebugCommands(vi.fn());
    commands.register('state', 'x', () => 1);
    expect(() => {
      commands.register('state', 'y', () => 2);
    }).toThrow(/already registered/);
    for (const bad of ['', 'Bad', 'with space', '1st', 'kebab-case', 'help']) {
      expect(() => {
        commands.register(bad, 'x', () => 0);
      }).toThrow(/Invalid/);
    }
  });

  it('stubs name the phase that implements them and never throw', () => {
    const log = vi.fn();
    const commands = new DebugCommands(log);
    commands.registerStub('giveAmmo', 'Refill ammo', 'Phase 2 (weapon framework)');

    const result = commands.run('giveAmmo');

    expect(result).toEqual({
      ok: false,
      command: 'giveAmmo',
      reason: 'tls.giveAmmo() is not available yet: it arrives with Phase 2 (weapon framework).',
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Phase 2'));
    expect(commands.list()[0]).toMatchObject({
      available: false,
      plannedFor: 'Phase 2 (weapon framework)',
    });
  });

  it('throws a helpful error for unknown commands', () => {
    expect(() => new DebugCommands(vi.fn()).run('nope')).toThrow(
      /Unknown debug command "nope".*tls\.help/,
    );
  });

  it('lists commands sorted by name', () => {
    const commands = new DebugCommands(vi.fn());
    commands.register('zeta', 'z', () => 0);
    commands.registerStub('alpha', 'a', 'later');
    commands.register('mid', 'm', () => 0);
    expect(commands.list().map((c) => c.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('builds a frozen console API with one function per command plus help()', () => {
    const log = vi.fn();
    const commands = new DebugCommands(log);
    commands.register('state', 'Current state', () => 'MAIN_MENU');
    commands.registerStub('killAll', 'Kill every enemy', 'Phase 4');

    const api = commands.toApi();

    expect(Object.isFrozen(api)).toBe(true);
    expect(api.state?.()).toBe('MAIN_MENU');
    expect(api.killAll?.()).toMatchObject({ ok: false });
    const listed = api.help();
    expect(listed.map((c) => c.name)).toEqual(['killAll', 'state']);
    const helpText = String(log.mock.calls.at(-1)?.[0]);
    expect(helpText).toContain('tls.state');
    expect(helpText).toContain('[planned: Phase 4]');
  });
});

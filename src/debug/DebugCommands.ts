/**
 * Registry for developer console commands (plan §29, D-020). Development builds expose the
 * registry as `window.tls`: every command becomes `tls.<name>(...)`, and `tls.help()` lists them.
 *
 * Commands whose systems do not exist yet are registered as stubs naming the phase that will
 * implement them, so the plan's full command list is discoverable from day one.
 */

export type DebugCommandFn = (...args: never[]) => unknown;

export interface DebugCommand {
  readonly name: string;
  readonly description: string;
  /** False for stubs whose system is not implemented yet. */
  readonly available: boolean;
  /** For stubs: the phase that will implement the command. */
  readonly plannedFor?: string;
  readonly run: DebugCommandFn;
}

export interface StubResult {
  readonly ok: false;
  readonly command: string;
  readonly reason: string;
}

export type DebugApi = Readonly<Record<string, DebugCommandFn>> & {
  readonly help: () => readonly DebugCommand[];
};

const COMMAND_NAME = /^[a-z][A-Za-z0-9]*$/;
const RESERVED = new Set(['help']);

export class DebugCommands {
  private readonly commands = new Map<string, DebugCommand>();
  private readonly log: (message: string) => void;

  /** @param log Where stubs and help print (default `console.info`). */
  constructor(
    log: (message: string) => void = (message) => {
      console.info(message);
    },
  ) {
    this.log = log;
  }

  /** Registers a working command. Names must be camelCase identifiers and unique. */
  register(name: string, description: string, run: DebugCommandFn): void {
    this.add({ name, description, available: true, run });
  }

  /** Registers a planned command that reports which phase will implement it. */
  registerStub(name: string, description: string, plannedFor: string): void {
    const reason = `tls.${name}() is not available yet: it arrives with ${plannedFor}.`;
    this.add({
      name,
      description,
      available: false,
      plannedFor,
      run: (): StubResult => {
        this.log(reason);
        return { ok: false, command: name, reason };
      },
    });
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** All commands, sorted by name. */
  list(): readonly DebugCommand[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  run(name: string, ...args: never[]): unknown {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error(`Unknown debug command "${name}". Try tls.help().`);
    }
    return command.run(...args);
  }

  /** A frozen object with one function per command, plus `help()`. */
  toApi(): DebugApi {
    const api: Record<string, DebugCommandFn> = {};
    for (const command of this.commands.values()) {
      api[command.name] = command.run;
    }
    api.help = () => {
      const commands = this.list();
      const width = Math.max(...commands.map((c) => c.name.length));
      this.log(
        [
          'THE LAST SIGNAL debug commands (development builds only):',
          ...commands.map(
            (c) =>
              `  tls.${c.name.padEnd(width)}  ${c.description}${c.available ? '' : `  [planned: ${c.plannedFor ?? '?'}]`}`,
          ),
        ].join('\n'),
      );
      return commands;
    };
    return Object.freeze(api) as DebugApi;
  }

  private add(command: DebugCommand): void {
    if (!COMMAND_NAME.test(command.name) || RESERVED.has(command.name)) {
      throw new Error(`Invalid debug command name "${command.name}"`);
    }
    if (this.commands.has(command.name)) {
      throw new Error(`Debug command "${command.name}" is already registered`);
    }
    this.commands.set(command.name, command);
  }
}

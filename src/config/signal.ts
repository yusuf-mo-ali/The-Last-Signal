/**
 * Signal progression and environment states (plan §18–19, GAME_DESIGN §12, D-028).
 */

/** Plan §18 environment states (the plan's "NIGHT MODE" is `NIGHT_MODE`). */
export const ENVIRONMENT_STATES = [
  'NORMAL',
  'POWER_FAILURE',
  'EMERGENCY_LIGHTING',
  'STRUCTURAL_DAMAGE',
  'HEAVY_SMOKE',
  'NIGHT_MODE',
  'SIGNAL_OVERLOAD',
] as const;
export type EnvironmentState = (typeof ENVIRONMENT_STATES)[number];

export const SIGNAL_PHASE_IDS = [
  'collectComponents',
  'restorePower',
  'repairTransmitter',
  'chargeTransmitter',
  'transmit',
] as const;
export type SignalPhaseId = (typeof SIGNAL_PHASE_IDS)[number];

export interface SignalPhaseConfig {
  readonly id: SignalPhaseId;
  readonly name: string;
  /** Inclusive wave range (plan §19). */
  readonly firstWave: number;
  readonly lastWave: number;
  /** Base environment during the phase (D-028: mutations and events overlay it). */
  readonly baseEnvironment: EnvironmentState;
}

/** Plan §19 progression; base environments from GAME_DESIGN §12 [Proposed]. */
export const SIGNAL_PHASES: readonly SignalPhaseConfig[] = [
  {
    id: 'collectComponents',
    name: 'Collect components',
    firstWave: 1,
    lastWave: 5,
    baseEnvironment: 'POWER_FAILURE',
  },
  {
    id: 'restorePower',
    name: 'Restore power',
    firstWave: 6,
    lastWave: 10,
    baseEnvironment: 'EMERGENCY_LIGHTING',
  },
  {
    id: 'repairTransmitter',
    name: 'Repair transmitter',
    firstWave: 11,
    lastWave: 15,
    baseEnvironment: 'NORMAL',
  },
  {
    id: 'chargeTransmitter',
    name: 'Charge transmitter',
    firstWave: 16,
    lastWave: 19,
    baseEnvironment: 'SIGNAL_OVERLOAD',
  },
  {
    id: 'transmit',
    name: 'Transmit final signal',
    firstWave: 20,
    lastWave: 20,
    baseEnvironment: 'SIGNAL_OVERLOAD',
  },
];

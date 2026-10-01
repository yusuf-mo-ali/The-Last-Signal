import { describe, expect, it } from 'vitest';
import { AI_STATES, type AiState } from '../../config/enemies';
import {
  ENEMY_TRANSITIONS,
  EnemyStateMachine,
  InvalidEnemyTransitionError,
} from './EnemyStateMachine';

/**
 * The expected rules, written independently of the implementation's table (TESTING §4: test
 * against independent truth). Each line reads "from → allowed targets".
 */
const EXPECTED: Readonly<Record<AiState, readonly AiState[]>> = {
  IDLE: ['PATROL', 'DETECT', 'STAGGER', 'DEAD'], // no target: wander, notice, get hit or die
  PATROL: ['IDLE', 'DETECT', 'STAGGER', 'DEAD'],
  DETECT: ['CHASE', 'ATTACK', 'IDLE', 'STAGGER', 'DEAD'], // after the tell: chase, or attack if close
  CHASE: ['ATTACK', 'IDLE', 'STAGGER', 'DEAD'], // IDLE = target lost
  ATTACK: ['CHASE', 'IDLE', 'STAGGER', 'DEAD'],
  STAGGER: ['IDLE', 'CHASE', 'ATTACK', 'DEAD'], // recovers into whatever fits
  DEAD: [],
};

describe('enemy AI transitions', () => {
  it('uses exactly the plan’s seven states', () => {
    expect(Object.keys(ENEMY_TRANSITIONS).sort()).toEqual([...AI_STATES].sort());
  });

  describe('all 49 state pairs match the independent table', () => {
    for (const from of AI_STATES) {
      for (const to of AI_STATES) {
        const legal = EXPECTED[from].includes(to);
        it(`${from} → ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
          const fsm = new EnemyStateMachine({ initial: from });
          expect(fsm.canTransition(to)).toBe(legal);
          expect(fsm.transition(to)).toBe(legal);
          expect(fsm.state).toBe(legal ? to : from);
        });
      }
    }
  });

  it('DEAD is terminal and every living state can die', () => {
    for (const from of AI_STATES) {
      const fsm = new EnemyStateMachine({ initial: from });
      expect(fsm.canTransition('DEAD')).toBe(from !== 'DEAD');
    }
    const dead = new EnemyStateMachine({ initial: 'DEAD' });
    for (const to of AI_STATES) {
      expect(dead.transition(to)).toBe(false);
    }
  });

  it('there are no self-transitions', () => {
    for (const state of AI_STATES) {
      expect(new EnemyStateMachine({ initial: state }).canTransition(state)).toBe(false);
    }
  });

  it('strict mode throws on an illegal transition and changes nothing', () => {
    const fsm = new EnemyStateMachine({ initial: 'IDLE', strict: true });
    expect(() => fsm.transition('ATTACK')).toThrow(InvalidEnemyTransitionError);
    expect(fsm.state).toBe('IDLE');
  });

  it('tells its listener about every change, with the time in state reset', () => {
    const changes: string[] = [];
    const fsm = new EnemyStateMachine({ onChange: (from, to) => changes.push(`${from}>${to}`) });
    fsm.advance(0.5);
    expect(fsm.time).toBe(0.5);
    fsm.transition('DETECT');
    expect(fsm.time).toBe(0);
    fsm.transition('CHASE');
    fsm.transition('IDLE'); // illegal from CHASE? no: target lost → IDLE is legal
    fsm.transition('ATTACK'); // illegal from IDLE: ignored
    expect(changes).toEqual(['IDLE>DETECT', 'DETECT>CHASE', 'CHASE>IDLE']);
  });

  it('reset returns to IDLE for reuse without telling the listener', () => {
    const changes: string[] = [];
    const fsm = new EnemyStateMachine({
      initial: 'DEAD',
      onChange: (from, to) => changes.push(`${from}>${to}`),
    });
    fsm.advance(3);
    fsm.reset();
    expect(fsm.state).toBe('IDLE');
    expect(fsm.time).toBe(0);
    expect(changes).toEqual([]);
    expect(fsm.is('IDLE')).toBe(true);
  });
});

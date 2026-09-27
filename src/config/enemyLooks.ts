/**
 * Placeholder looks for enemies (D-030 blockout, D-043): presentation data only, read by
 * `enemies/EnemyView`. Each archetype is drawn from its own hit volumes, so size and build come from
 * its rig (the Runner slighter, the Tank huge, the Screamer tall with a big head); this file adds
 * the palette by zone, the eyes, the wind-up glow and small silhouette features. Posture (a lean or
 * hunch) is part of the rig, so what is drawn is what can be hit. Traits add attachments that
 * change the outline, so they read without relying on colour alone.
 */

import type { DamageZone, EnemyArchetypeId, EnemyModifierId } from './enemies';

export interface EnemyLook {
  readonly zoneColors: Readonly<Record<DamageZone, number>>;
  readonly eyes: number;
  /** Colour of the attack's wind-up glow (the telegraph). */
  readonly telegraph: number;
  /** A gaping mouth on the front of the head (the Screamer), as a fraction of the head's radius. */
  readonly mouth?: { readonly color: number; readonly size: number };
  /**
   * Arm angle about the shoulders during the attack's wind-up (radians; positive swings a hanging
   * arm forward): reaching forward for a strike, raised overhead for a scream. Matches the rig's
   * attack pose.
   */
  readonly windupArms: number;
}

const zones = (
  skin: number,
  shirt: number,
  trousers: number,
): Readonly<Record<DamageZone, number>> => ({
  HEAD: skin,
  TORSO: shirt,
  ARM_LEFT: skin,
  ARM_RIGHT: skin,
  LEG_LEFT: trousers,
  LEG_RIGHT: trousers,
});

/** Arm angle of the reach pose (arms forward at shoulder height). */
export const REACH_ARMS = 1.45;
/** Arm angle of the raised pose (arms up and forward over the head): `armsRaisedPose`. */
export const RAISED_ARMS = (135 * Math.PI) / 180;

export const ENEMY_LOOKS: Readonly<Partial<Record<EnemyArchetypeId, EnemyLook>>> = {
  // Pale green skin, a dark shirt and trousers; nothing reads as the beacon's red.
  walker: {
    zoneColors: { ...zones(0x9db38a, 0x5a5048, 0x3b4454), HEAD: 0x9db38a },
    eyes: 0xffe36b,
    telegraph: 0xff8c1a,
    windupArms: REACH_ARMS,
  },
  // Grey, bloodless skin and a torn dark red top; red eyes. (Its sprinter's lean is in its rig.)
  runner: {
    zoneColors: zones(0xb8bfae, 0x6e2b27, 0x2f3a45),
    eyes: 0xff5a3c,
    telegraph: 0xffc024,
    windupArms: REACH_ARMS,
  },
  // Dark and heavy (hunched: in its rig); a lighter head so the weak point stands out.
  tank: {
    zoneColors: { ...zones(0x6f8260, 0x33373c, 0x26292e), HEAD: 0x9aae86 },
    eyes: 0xffe36b,
    telegraph: 0xff3c1a,
    windupArms: REACH_ARMS,
  },
  // Pale violet skin and clothes, violet eyes and a gaping mouth; it throws its arms up to scream.
  screamer: {
    zoneColors: zones(0xd4cce0, 0x4b3a5c, 0x3a3448),
    eyes: 0xc58cff,
    telegraph: 0xb46cff,
    mouth: { color: 0x1a0f22, size: 0.55 },
    windupArms: RAISED_ARMS,
  },
};

/** What each trait adds to the outline (built into the enemy's single mesh). */
export interface TraitLook {
  readonly color: number;
}

export const TRAIT_LOOKS: Readonly<Record<EnemyModifierId, TraitLook>> = {
  // Plates over the chest and back and on the shoulders.
  armored: { color: 0x6c737c },
  // A steel dome over the head, gone once the helmet breaks.
  helmeted: { color: 0x8a939c },
  // Bone spikes along the shoulders and the spine, and hot pale eyes.
  elite: { color: 0xe0cd84 },
};

/** Eye colour of an Elite (on any archetype). */
export const ELITE_EYES = 0xfff4b0;

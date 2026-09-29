/**
 * Turns the resolved environment channels (D-028, D-045) into light intensities and colours.
 * Presentation only. Every light it touches exists from load (D-022): it only changes intensity,
 * colour, the fog and the background, all uniforms, so no shader is ever recompiled (the E2E checks
 * the program count across a blackout).
 *
 * The base values are read from the rig when it is built, so with the base environment the scene
 * looks exactly as it did before any of this existed.
 */

import { Color, SRGBColorSpace } from 'three';
import type { EnvironmentChannels } from '../config/environment';
import { LIGHTING } from '../config/environment';
import type { LightRig } from './WorldView';

const _tint = new Color();

export class LightingController {
  private readonly rig: LightRig;
  private readonly base: {
    readonly hemisphere: number;
    readonly sky: Color;
    readonly ground: Color;
    readonly sun: number;
    readonly sunColor: Color;
  };
  private lastKey = '';

  constructor(rig: LightRig) {
    this.rig = rig;
    this.base = {
      hemisphere: rig.hemisphere.intensity,
      sky: rig.hemisphere.color.clone(),
      ground: rig.hemisphere.groundColor.clone(),
      sun: rig.sun.intensity,
      sunColor: rig.sun.color.clone(),
    };
  }

  /** Applies the channels (writes only when something changed). */
  update(c: EnvironmentChannels): void {
    const key = [c.ambient, c.sun, c.tintAmount, c.emergency, ...c.tint, ...c.fog]
      .map((v) => v.toFixed(4))
      .join(',');
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    const { hemisphere, sun, emergency, lamp, fog, background } = this.rig;
    _tint.setRGB(c.tint[0], c.tint[1], c.tint[2], SRGBColorSpace);
    hemisphere.intensity = this.base.hemisphere * c.ambient;
    hemisphere.color.copy(this.base.sky).lerp(_tint, c.tintAmount);
    hemisphere.groundColor.copy(this.base.ground).lerp(_tint, c.tintAmount * 0.5);
    sun.intensity = this.base.sun * c.sun;
    sun.color.copy(this.base.sunColor).lerp(_tint, c.tintAmount);
    // Environment colours are sRGB (like the hex colours they replace).
    fog.color.setRGB(c.fog[0], c.fog[1], c.fog[2], SRGBColorSpace);
    background.setRGB(c.fog[0], c.fog[1], c.fog[2], SRGBColorSpace);
    for (const light of emergency) {
      light.intensity = LIGHTING.emergency.intensity * c.emergency;
    }
    lamp.emissiveIntensity = LIGHTING.emergencyLampGlow * c.emergency;
  }

  /** Current values (tests, debug). */
  get state(): {
    readonly ambient: number;
    readonly sun: number;
    readonly emergency: number;
  } {
    return {
      ambient: this.rig.hemisphere.intensity,
      sun: this.rig.sun.intensity,
      emergency: this.rig.emergency[0]?.intensity ?? 0,
    };
  }
}

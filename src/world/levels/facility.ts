/**
 * "Facility": the Phase 1 gameplay blockout (plan §8). A compact prototype map for testing FPS
 * movement: open yard, corridors, doorways, a crouch-only duct, a raised catwalk reached by
 * stairs and a ramp, a loading dock to jump onto, and obstacles of several heights.
 *
 * Grey-box only; not final art. The signal tower in the yard centre is where the beacon sits.
 *
 * Layout (x east, z south, metres; the playable area is x, z ∈ [-24, 24]):
 *
 *   z=-24 ┌──────────────────────┬─────┬──┬──────────┐
 *         │ west   ║ CONTROL ROOM ║mass │C │GENERATOR │   C = service corridor
 *         │ annex  D   (roof)     =duct=  │ D  HALL   │   D = doorway, = = crawl duct
 *   z=-12 │ stairs ╚═════D════════╝     │  │          │
 *         │ ▲catwalk                         (open)   │
 *         │ ║          YARD   ■ tower                 │
 *         │ ▼ramp                                     │
 *   z=+24 └──────────── loading dock ─────────────────┘
 *        x=-24                                      x=+24
 */

import type { Brush, LevelDefinition, SurfaceKind, Vec3 } from './types';

const box = (min: Vec3, max: Vec3, surface: SurfaceKind): Brush => ({
  kind: 'box',
  min,
  max,
  surface,
});

/** Half-extent of the playable area. */
export const FACILITY_HALF_SIZE = 24;
const H = FACILITY_HALF_SIZE;
/** Perimeter walls are tall enough that nothing in the map lets the player over them. */
const PERIMETER_HEIGHT = 6;
const PERIMETER_THICKNESS = 0.6;

/** Interior walls (0.4 m thick): height, and doorway height. */
const WALL_HEIGHT = 3.6;
const DOOR_HEIGHT = 2.6;

/** The crawl duct's clear height: above the crouched capsule, below the standing one. */
export const DUCT_CLEARANCE = 1.25;

/** Top of the west catwalk. */
export const CATWALK_HEIGHT = 2.5;

/** Top of the loading dock (a jump up). */
export const DOCK_HEIGHT = 0.9;

const perimeter: Brush[] = [
  box([-H - 1, -1, -H - 1], [H + 1, 0, H + 1], 'ground'),
  box(
    [-H - PERIMETER_THICKNESS, 0, -H - PERIMETER_THICKNESS],
    [H + PERIMETER_THICKNESS, PERIMETER_HEIGHT, -H],
    'wall',
  ),
  box(
    [-H - PERIMETER_THICKNESS, 0, H],
    [H + PERIMETER_THICKNESS, PERIMETER_HEIGHT, H + PERIMETER_THICKNESS],
    'wall',
  ),
  box([-H - PERIMETER_THICKNESS, 0, -H], [-H, PERIMETER_HEIGHT, H], 'wall'),
  box([H, 0, -H], [H + PERIMETER_THICKNESS, PERIMETER_HEIGHT, H], 'wall'),
];

/** Central yard: the signal tower and obstacles of different heights. */
const yard: Brush[] = [
  box([-1.2, 0, -1.2], [1.2, 7, 1.2], 'structure'), // signal tower
  box([3, 0, 4], [4.2, 0.8, 5.2], 'crate'), // jumpable
  box([-5, 0, 3], [-3.8, 0.8, 4.2], 'crate'), // jumpable
  box([5, 0, -4], [6.4, 1.6, -2.6], 'crate'), // too tall to jump
  box([-8, 0, -6], [-5.5, 2.6, -1], 'metal'), // shipping container
  box([6, 0, 6], [9, 1, 6.4], 'structure'), // low barrier
];

/** Control room: x ∈ [-10, 10], z ∈ [-24, -12.4], roofed, three ways in. */
const controlRoom: Brush[] = [
  // South wall with a central doorway (x ∈ [-1.5, 1.5]).
  box([-10.4, 0, -12.4], [-1.5, WALL_HEIGHT, -12], 'wall'),
  box([1.5, 0, -12.4], [10.4, WALL_HEIGHT, -12], 'wall'),
  box([-1.5, DOOR_HEIGHT, -12.4], [1.5, WALL_HEIGHT, -12], 'wall'),
  // West wall with a doorway (z ∈ [-19, -17]).
  box([-10.4, 0, -H], [-10, WALL_HEIGHT, -19], 'wall'),
  box([-10.4, 0, -17], [-10, WALL_HEIGHT, -12.4], 'wall'),
  box([-10.4, DOOR_HEIGHT, -19], [-10, WALL_HEIGHT, -17], 'wall'),
  // East side: a solid mass (x ∈ [10, 13.4]) pierced by the crawl duct (z ∈ [-18.6, -17.4]).
  box([10, 0, -H], [13.4, WALL_HEIGHT, -18.6], 'wall'),
  box([10, 0, -17.4], [13.4, WALL_HEIGHT, -12.4], 'wall'),
  box([10, DUCT_CLEARANCE, -18.6], [13.4, WALL_HEIGHT, -17.4], 'wall'),
  // Roof, and furniture.
  box([-10.4, WALL_HEIGHT, -H], [13.4, WALL_HEIGHT + 0.3, -12], 'structure'),
  box([-4, 0, -20], [4, 1, -19], 'metal'), // console desk
  box([-7, 0, -15], [-6.4, WALL_HEIGHT, -14.4], 'structure'), // pillar
  box([6.4, 0, -15], [7, WALL_HEIGHT, -14.4], 'structure'), // pillar
];

/** Service corridor (x ∈ [13.4, 16]) and the generator hall east of it, open to the yard. */
const eastWing: Brush[] = [
  box([13, 0, -12.4], [13.4, WALL_HEIGHT, -6], 'wall'), // corridor west wall, south of the mass
  // Corridor east wall with a doorway into the hall (z ∈ [-14, -11.5]).
  box([16, 0, -H], [16.4, WALL_HEIGHT, -14], 'wall'),
  box([16, 0, -11.5], [16.4, WALL_HEIGHT, -6], 'wall'),
  box([16, DOOR_HEIGHT, -14], [16.4, WALL_HEIGHT, -11.5], 'wall'),
  box([18, 0, -20], [21, 2.2, -16], 'metal'), // generator
  box([19, 0, -12], [22, 1.4, -9], 'metal'), // transformer
];

/** West catwalk (top y = 2.5), reached by stairs from the north and a ramp from the south. */
const catwalk: Brush[] = [
  box([-H, 2.2, -8], [-20.5, CATWALK_HEIGHT, 10], 'metal'),
  box([-21.2, 0, -4], [-20.6, 2.2, -3.4], 'structure'), // support
  box([-21.2, 0, 4], [-20.6, 2.2, 4.6], 'structure'), // support
  // Railing along the open edge, with a gap at z ∈ [0, 2] to drop down through.
  box([-20.8, CATWALK_HEIGHT, -8], [-20.5, CATWALK_HEIGHT + 1.2, 0], 'accent'),
  box([-20.8, CATWALK_HEIGHT, 2], [-20.5, CATWALK_HEIGHT + 1.2, 10], 'accent'),
  {
    kind: 'stairs',
    min: [-H, 0, -15],
    max: [-20.5, CATWALK_HEIGHT, -8],
    rise: '+z',
    steps: 10,
    surface: 'structure',
  },
  {
    kind: 'ramp',
    min: [-H, 0, 10],
    max: [-20.5, CATWALK_HEIGHT, 17],
    rise: '-z',
    surface: 'structure',
  },
];

/** Loading bay: a dock to jump onto (or walk up its ramp) and two parked trucks. */
const loadingBay: Brush[] = [
  box([-8, 0, 19], [8, DOCK_HEIGHT, H], 'structure'),
  { kind: 'ramp', min: [8, 0, 19], max: [11, DOCK_HEIGHT, H], rise: '-x', surface: 'structure' },
  box([-16, 0, 14], [-12, 2.8, 20], 'metal'),
  box([12, 0, 12], [15, 2.6, 17], 'metal'),
];

export const FACILITY: LevelDefinition = {
  name: 'Facility (blockout)',
  spawn: { position: [0, 0, 14], yaw: 0 }, // facing the tower and its beacon
  killPlaneY: -20,
  brushes: [...perimeter, ...yard, ...controlRoom, ...eastWing, ...catwalk, ...loadingBay],
};

/** Where the signal beacon sits: on top of the tower. */
export const FACILITY_BEACON_POSITION: Vec3 = [0, 7.6, 0];

/**
 * A walk through every area of the map, used by the headless traversal test and the browser E2E
 * test. Each waypoint is a ground position `[x, z]`; `crouch` and `jump` mark the leg that needs
 * them to reach the waypoint.
 */
export interface RouteWaypoint {
  readonly x: number;
  readonly z: number;
  readonly crouch?: boolean;
  readonly jump?: boolean;
  /** Expected feet height on arrival (ground is 0). */
  readonly y: number;
  readonly area: string;
}

export const FACILITY_ROUTE: readonly RouteWaypoint[] = [
  { x: 3, z: -3, y: 0, area: 'yard' },
  { x: 0, z: -10, y: 0, area: 'yard' },
  { x: 0, z: -14, y: 0, area: 'control room (south door)' },
  { x: 8.5, z: -18, y: 0, area: 'control room' },
  { x: 14.7, z: -18, y: 0, crouch: true, area: 'crawl duct → service corridor' },
  { x: 14.7, z: -12.75, y: 0, area: 'service corridor' },
  { x: 17.2, z: -12.75, y: 0, area: 'generator hall (door)' },
  { x: 17.2, z: -4, y: 0, area: 'generator hall → yard' },
  { x: 10, z: -3, y: 0, area: 'yard' },
  { x: 2.5, z: -9, y: 0, area: 'yard' },
  { x: 0, z: -14, y: 0, area: 'control room (south door)' },
  { x: -8, z: -18, y: 0, area: 'control room' },
  { x: -12.5, z: -18, y: 0, area: 'west annex (west door)' },
  { x: -22.25, z: -16.5, y: 0, area: 'foot of the stairs' },
  { x: -22.25, z: -6, y: CATWALK_HEIGHT, area: 'catwalk (via stairs)' },
  { x: -22.25, z: 9, y: CATWALK_HEIGHT, area: 'catwalk' },
  { x: -22.25, z: 18.5, y: 0, area: 'foot of the ramp' },
  { x: -22.25, z: 22.5, y: 0, area: 'south-west corner' },
  { x: -9, z: 22.5, y: 0, area: 'loading bay' },
  { x: -6, z: 22.5, y: DOCK_HEIGHT, jump: true, area: 'loading dock (jump up)' },
  { x: 7, z: 22.5, y: DOCK_HEIGHT, area: 'loading dock' },
  { x: 12.5, z: 22.5, y: 0, area: 'dock ramp (down)' },
  { x: 17, z: 19, y: 0, area: 'south-east yard' },
  { x: 17, z: 6, y: 0, area: 'east yard' },
  { x: 0, z: 14, y: 0, area: 'spawn' },
];

import { START_TIME_PASSED } from '../constants';
import { Provisions, fleets, Fleets } from '../game/world/fleets';
import type { Port } from '../game/port/port';
import type { World } from '../game/world/world';
import type { QuestId } from '../interface/quest/questData';
import { ItemId } from '../data/itemData';
import type { Direction, Position } from '../types';
import type { AutoNavigationStrategyId } from '../game/world/autoNavigation';

export type Stage = 'world' | 'port' | 'building';

export type Velocity = {
  direction: number;
  speed: number;
};

export type ProvisionsType = {
  [key in Provisions]: number;
};

type UsedShipsAtPort = { [key: string]: UsedShips };
export type UsedShips = { [key: string]: string };

export type Role =
  | number
  | 'firstMate'
  | 'bookKeeper'
  | 'chiefNavigator'
  | null;

type Mate = {
  sailorId: string;
  role: Role;
};

export interface AutoNavigationState {
  enabled: boolean;
  targetPortId: string | null;
  targetPosition: Position | null;
  strategyId: AutoNavigationStrategyId;
  path: Position[];
  waypointIndex: number;
  lastPosition: Position | null;
  stagnantMoves: number;
  useAlternateAxis: boolean;
  debug: AutoNavigationDebug | null;
}

export type AutoNavigationDebugReason =
  | 'tracking'
  | 'arrived'
  | 'stagnant-alternate-axis'
  | 'coastal-axis-switch'
  | 'deep-detour-created'
  | 'deep-detour-failed'
  | 'deep-detour-target-too-close'
  | 'deep-stagnant-skip';

export interface AutoNavigationDebug {
  position: Position;
  heading: Direction | '';
  waypoint: Position | null;
  waypointIndex: number;
  waypointCount: number;
  distanceToWaypoint: number | null;
  reachedDistance: number | null;
  positionSea: boolean;
  waypointSea: boolean | null;
  positionOpenSea: boolean | null;
  waypointOpenSea: boolean | null;
  reason: AutoNavigationDebugReason;
  message: string;
  detourTarget: Position | null;
  detourTargetIndex: number | null;
  detourTargetDistance: number | null;
  detourPathLength: number | null;
}

export interface State {
  portId: string | null;
  buildingId: string | null;
  timePassed: number;
  world: World;
  fleets: Fleets;
  seaArea: number | undefined;
  wind: Velocity;
  current: Velocity;
  playerFleet: Velocity;
  port: Port;
  dayAtSea: number;
  gold: number;
  quests: QuestId[];
  usedShipsAtPort: UsedShipsAtPort;
  savings: number;
  debt: number;
  items: ItemId[];
  mates: Mate[];
  autoNavigation: AutoNavigationState;
}

export const getDefaultAutoNavigation = (): AutoNavigationState => ({
  enabled: false,
  targetPortId: null,
  targetPosition: null,
  strategyId: 'balanced',
  path: [],
  waypointIndex: 0,
  lastPosition: null,
  stagnantMoves: 0,
  useAlternateAxis: false,
  debug: null,
});

const state = {
  portId: null,
  buildingId: null,
  timePassed: START_TIME_PASSED,
  fleets: {
    ...fleets,
    '1': {
      position: undefined,
      ships: [
        {
          id: '6',
          name: 'Sea Trial',
          crew: 10,
          cargo: [
            {
              type: 'water',
              quantity: 10,
            },
            {
              type: 'food',
              quantity: 10,
            },
          ],
          durability: 30,
        },
      ],
    },
  },
  dayAtSea: 0,
  gold: 0,
  quests: [] as QuestId[],
  usedShipsAtPort: {},
  savings: 0,
  debt: 0,
  items: [],
  mates: [
    {
      sailorId: '1',
      role: 0,
    },
  ] as Mate[],
  autoNavigation: getDefaultAutoNavigation(),
} as unknown as State;

export default state;

import { START_TIME_PASSED } from '../constants';
import { Provisions, fleets, Fleets } from '../game/world/fleets';
import type { Port } from '../game/port/port';
import type { World } from '../game/world/world';
import type { QuestId } from '../interface/quest/questData';
import { ItemId } from '../data/itemData';
import type { Position } from '../types';
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

export const SAVED_STATE_KEY = 'savedState';

const savedState = JSON.parse(
  window.localStorage.getItem(SAVED_STATE_KEY) || '{}',
);

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
  ...savedState,
} as State;

export default state;

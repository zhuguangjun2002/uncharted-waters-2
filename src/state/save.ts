import state, { getDefaultAutoNavigation, State } from './state';
import type { World } from '../game/world/world';
import type { Port } from '../game/port/port';
import Input from '../input';
import { updateGeneral } from './actionsPort';
import {
  setDockedFleetPositions,
  updateProvisions,
  updateWorldStatus,
} from './actionsWorld';
import { getPortData } from '../game/port/portUtils';
import { getDate } from '../interface/interfaceUtils';

export const SAVE_SLOT_COUNT = 10;
const SAVE_SLOTS_KEY = 'saveSlots';

/*
  The serializable fields of State. Runtime scene objects (`world`, `port`) and
  derived fields (`wind`, `current`, `playerFleet`, `seaArea`, `autoNavigation`)
  are intentionally excluded — they're recreated or recomputed on load.
 */
type PersistedState = Pick<
  State,
  | 'portId'
  | 'timePassed'
  | 'fleets'
  | 'dayAtSea'
  | 'gold'
  | 'quests'
  | 'usedShipsAtPort'
  | 'savings'
  | 'debt'
  | 'items'
  | 'mates'
>;

interface SaveSlotMeta {
  savedAt: number; // real-world Date.now() the save was made
  timePassed: number; // in-game time
  portId: string | null; // port the player was docked at, or null if at sea
}

interface SaveSlot {
  meta: SaveSlotMeta;
  data: PersistedState;
}

type SaveSlots = (SaveSlot | null)[];

export interface SlotSummary {
  index: number;
  empty: boolean;
  location: string; // port name, or 'At Sea'
  inGameDate: string; // formatted in-game date
  savedAt: string; // formatted real-world save time
}

const readSlots = (): SaveSlots => {
  const slots: SaveSlots = Array.from({ length: SAVE_SLOT_COUNT }, () => null);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(window.localStorage.getItem(SAVE_SLOTS_KEY) || 'null');
  } catch {
    parsed = null;
  }

  if (Array.isArray(parsed)) {
    for (let i = 0; i < SAVE_SLOT_COUNT; i += 1) {
      if (parsed[i]) {
        slots[i] = parsed[i] as SaveSlot;
      }
    }
  }

  return slots;
};

const writeSlots = (slots: SaveSlots): boolean => {
  try {
    window.localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
};

export const getSlotSummaries = (): SlotSummary[] =>
  readSlots().map((slot, index) => {
    if (!slot) {
      return { index, empty: true, location: '', inGameDate: '', savedAt: '' };
    }

    const { meta } = slot;

    return {
      index,
      empty: false,
      location: meta.portId ? getPortData(meta.portId).name : 'At Sea',
      inGameDate: getDate(meta.timePassed),
      savedAt: new Date(meta.savedAt).toLocaleString(),
    };
  });

export const saveToSlot = (index: number): boolean => {
  const slots = readSlots();

  slots[index] = {
    meta: {
      savedAt: Date.now(),
      timePassed: state.timePassed,
      portId: state.portId,
    },
    data: {
      portId: state.portId,
      timePassed: state.timePassed,
      fleets: state.fleets,
      dayAtSea: state.dayAtSea,
      gold: state.gold,
      quests: state.quests,
      usedShipsAtPort: state.usedShipsAtPort,
      savings: state.savings,
      debt: state.debt,
      items: state.items,
      mates: state.mates,
    },
  };

  return writeSlots(slots);
};

export const deleteSlot = (index: number): boolean => {
  const slots = readSlots();
  slots[index] = null;
  return writeSlots(slots);
};

/*
  Replaces the live game state with a saved slot and re-initializes the
  interface and scenes. The State object is mutated in place because it's a
  shared singleton imported by reference throughout the codebase. Clearing
  `world`/`port` forces the game loop to rebuild the scene for the loaded
  location.
 */
export const loadFromSlot = (index: number): boolean => {
  const slot = readSlots()[index];

  if (!slot) {
    return false;
  }

  const { data } = slot;

  state.portId = data.portId;
  state.buildingId = null;
  state.timePassed = data.timePassed;
  state.fleets = data.fleets;
  state.dayAtSea = data.dayAtSea;
  state.gold = data.gold;
  state.quests = data.quests;
  state.usedShipsAtPort = data.usedShipsAtPort;
  state.savings = data.savings;
  state.debt = data.debt;
  state.items = data.items;
  state.mates = data.mates;
  state.autoNavigation = getDefaultAutoNavigation();

  // Force the game loop to rebuild the scene for the loaded location.
  state.world = undefined as unknown as World;
  state.port = undefined as unknown as Port;

  Input.reset();
  updateGeneral();
  setDockedFleetPositions();

  if (state.portId === null) {
    updateWorldStatus();
    updateProvisions();
  }

  return true;
};

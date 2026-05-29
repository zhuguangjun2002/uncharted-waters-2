import type { AutoNavigationState, State, ProvisionsType } from './state';
import type { Position } from '../types';

interface UpdateInterface {
  general: (
    general: Pick<State, 'portId' | 'buildingId' | 'timePassed' | 'gold'>,
  ) => void;
  dayAtSea: (dayAtSea: number) => void;
  provisions: (provisions: ProvisionsType) => void;
  indicators: (indicators: Pick<State, 'wind' | 'current'>) => void;
  playerFleetDirection: (direction: number) => void;
  playerFleetSpeed: (speed: number) => void;
  worldMap: (worldMap: {
    visible: boolean;
    position: Position;
    autoNavigation: AutoNavigationState;
  }) => void;
  fade: (onComplete: () => void) => void;
  toast: (message: string) => void;
}

const updateInterface = {} as UpdateInterface;

export default updateInterface;

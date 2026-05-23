import { CardinalDirection, Direction, OrdinalDirection } from './types';

type MovementKey =
  | 'w'
  | 'a'
  | 's'
  | 'd'
  | 'arrowup'
  | 'arrowright'
  | 'arrowdown'
  | 'arrowleft';

const cardinalKeyMap: { [key in MovementKey]: CardinalDirection } = {
  w: 'n',
  d: 'e',
  s: 's',
  a: 'w',
  arrowup: 'n',
  arrowright: 'e',
  arrowdown: 's',
  arrowleft: 'w',
};

const ordinalKeyMap: {
  [key: string]: {
    [key: string]: OrdinalDirection;
  };
} = {
  n: {
    e: 'ne',
    w: 'nw',
  },
  s: {
    e: 'se',
    w: 'sw',
  },
};

export const directionMap: { [key in Direction | '']: number } = {
  n: 0,
  ne: 1,
  e: 2,
  se: 3,
  s: 4,
  sw: 5,
  w: 6,
  nw: 7,
  '': 8,
};

const isMovementKey = (key: string): key is MovementKey =>
  key in cardinalKeyMap;

let pressedMovementKeys: MovementKey[] = [];

let pressedE = false;

const PRESSED_E_TIME_MARGIN = 250;
let pressedETimeoutId: number;

const onKeydown = (e: KeyboardEvent) => {
  const pressedKey = e.key.toLowerCase();

  if (isMovementKey(pressedKey) && !pressedMovementKeys.includes(pressedKey)) {
    e.preventDefault();
    pressedMovementKeys.unshift(pressedKey);
  }
};

const onKeyup = (e: KeyboardEvent) => {
  const pressedKey = e.key.toLowerCase();

  if (isMovementKey(pressedKey)) {
    e.preventDefault();
    pressedMovementKeys = pressedMovementKeys.filter(
      (key) => key !== pressedKey,
    );
  }

  if (pressedKey === 'e') {
    pressedE = true;

    window.clearTimeout(pressedETimeoutId);
    pressedETimeoutId = window.setTimeout(() => {
      pressedE = false;
    }, PRESSED_E_TIME_MARGIN);
  }
};

const Input = {
  setup: () => {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keyup', onKeyup);
  },
  getDirection: (options: { includeOrdinal: boolean }): Direction | '' => {
    const pressedDirections = pressedMovementKeys.map(
      (key) => cardinalKeyMap[key],
    );

    if (!pressedDirections.length) {
      return '';
    }

    if (options.includeOrdinal && pressedDirections.length > 1) {
      const direction =
        ordinalKeyMap[pressedDirections[0]]?.[pressedDirections[1]] ||
        ordinalKeyMap[pressedDirections[1]]?.[pressedDirections[0]];

      if (direction) {
        return direction;
      }
    }

    return pressedDirections[0];
  },
  getPressedE: () => pressedE,
  reset: () => {
    pressedMovementKeys = [];

    pressedE = false;

    window.clearTimeout(pressedETimeoutId);
  },
};

export default Input;

import state, { getDefaultAutoNavigation } from './state';
import type { AutoNavigationState } from './state';

// loadFromSlot rebuilds the world/port scene as a side effect; stub those out so
// the test exercises only the serialization round-trip.
jest.mock('./actionsPort', () => ({ updateGeneral: jest.fn() }));
jest.mock('./actionsWorld', () => ({
  setDockedFleetPositions: jest.fn(),
  updateProvisions: jest.fn(),
  updateWorldStatus: jest.fn(),
}));
jest.mock('../input', () => ({ __esModule: true, default: { reset: jest.fn() } }));

// eslint-disable-next-line import/first
import { saveToSlot, loadFromSlot } from './save';

describe('save/load auto-navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    state.portId = null;
  });

  const inProgressRoute = (): AutoNavigationState => ({
    enabled: true,
    targetPortId: '118',
    targetPosition: { x: 2062, y: 156 },
    strategyId: 'deep',
    path: [
      { x: 1078, y: 416 },
      { x: 1100, y: 360 },
      { x: 2062, y: 156 },
    ],
    waypointIndex: 1,
    lastPosition: { x: 1090, y: 400 },
    stagnantMoves: 2,
    useAlternateAxis: false,
    debug: null,
  });

  test('persists an in-progress voyage across save and load', () => {
    state.autoNavigation = inProgressRoute();

    expect(saveToSlot(0)).toBe(true);

    // Wipe the live route, as a fresh page load would.
    state.autoNavigation = getDefaultAutoNavigation();

    expect(loadFromSlot(0)).toBe(true);

    expect(state.autoNavigation.enabled).toBe(true);
    expect(state.autoNavigation.strategyId).toBe('deep');
    expect(state.autoNavigation.targetPortId).toBe('118');
    expect(state.autoNavigation.waypointIndex).toBe(1);
    expect(state.autoNavigation.path).toEqual(inProgressRoute().path);
  });

  test('drops the transient debug field from saves', () => {
    state.autoNavigation = {
      ...inProgressRoute(),
      debug: {
        position: { x: 0, y: 0 },
        heading: 'n',
        waypoint: null,
        waypointIndex: 0,
        waypointCount: 0,
        distanceToWaypoint: null,
        reachedDistance: null,
        positionSea: true,
        waypointSea: null,
        positionOpenSea: null,
        waypointOpenSea: null,
        reason: 'tracking',
        message: '',
        detourTarget: null,
        detourTargetIndex: null,
        detourTargetDistance: null,
        detourPathLength: null,
      },
    };

    saveToSlot(0);
    loadFromSlot(0);

    expect(state.autoNavigation.debug).toBeNull();
  });

  test('loads pre-existing saves that predate the auto-navigation field', () => {
    state.autoNavigation = inProgressRoute();
    saveToSlot(0);

    // Simulate an older save by stripping the field from storage.
    const slots = JSON.parse(window.localStorage.getItem('saveSlots')!);
    delete slots[0].data.autoNavigation;
    window.localStorage.setItem('saveSlots', JSON.stringify(slots));

    state.autoNavigation = inProgressRoute();
    expect(loadFromSlot(0)).toBe(true);
    expect(state.autoNavigation).toEqual(getDefaultAutoNavigation());
  });
});

import Assets from './assets';
import Input from './input';
import renderInterface from './interface/Interface';
import createWorld from './game/world/world';
import createPort from './game/port/port';

import state from './state/state';
import uiState from './state/uiState';
import { updateGeneral } from './state/actionsPort';
import {
  setDockedFleetPositions,
  updateProvisions,
  updateWorldStatus,
} from './state/actionsWorld';

const start = async () => {
  await Assets.load();
  Input.setup();

  await renderInterface();

  updateGeneral();

  setDockedFleetPositions();

  if (state.portId === null) {
    updateWorldStatus();
    updateProvisions();
  }

  let wasSaveMenuOpen = false;

  const loop = () => {
    // Pause world/port updates while the save menu is open so the ship doesn't
    // keep drifting behind it. Clear any keys held when it closes.
    if (uiState.saveMenuOpen) {
      wasSaveMenuOpen = true;
      requestAnimationFrame(loop);
      return;
    }

    if (wasSaveMenuOpen) {
      wasSaveMenuOpen = false;
      Input.reset();
    }

    if (state.portId !== null) {
      if (!state.port) {
        state.port = createPort(state.portId);
      }

      if (state.buildingId === null) {
        state.port.update();
        state.port.draw();
      }
    }

    if (state.portId === null) {
      if (!state.world) {
        state.world = createWorld();
      }

      state.world.update();
      state.world.draw();
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
};

start();

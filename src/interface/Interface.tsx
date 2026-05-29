import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import Right from './Right';
import Left from './Left';
import PortInfo from './port/PortInfo';
import Provisions from './world/Provisions';
import Indicators from './world/Indicators';
import WorldMap from './world/WorldMap';
import AutoNavigationDebugOverlay from './world/AutoNavigationDebugOverlay';
import Camera from './Camera';
import updateInterface from '../state/updateInterface';
import uiState from '../state/uiState';
import Building from './port/Building';
import SaveMenu from './common/SaveMenu';
import { classNames } from './interfaceUtils';
import useFade from './port/hooks/useFade';
import type { Position } from '../types';
import { AutoNavigationState, getDefaultAutoNavigation } from '../state/state';

import './global.css';

type Props = {
  /*
    The state of Interface is updated outside of React. This is made possible
    by assigning setStates to an outside object. Calls to that object’s methods
    are delayed until Interface has mounted.

    Using a shared Redux Store could be a solution, but changes don’t happen
    fast enough.
   */
  resolve: () => void;
};

function Interface({ resolve }: Props) {
  const [portId, setPortId] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [timePassed, setTimePassed] = useState(0);
  const [gold, setGold] = useState(0);
  const [worldMap, setWorldMap] = useState<{
    visible: boolean;
    position: Position;
    autoNavigation: AutoNavigationState;
  }>({
    visible: false,
    position: { x: 0, y: 0 },
    autoNavigation: getDefaultAutoNavigation(),
  });
  const [toast, setToast] = useState('');
  // Open on boot so the player picks a save (or starts fresh) before playing.
  const [saveMenuVisible, setSaveMenuVisible] = useState(true);

  useEffect(() => {
    resolve();
  }, []);

  // F3 toggles the save/load menu. preventDefault stops the browser's default
  // F3 ("find") behaviour.
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f3' && !e.repeat) {
        e.preventDefault();
        setSaveMenuVisible((visible) => !visible);
      }
    };

    window.addEventListener('keydown', onKeydown);

    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  // Let the game loop know to pause world/port updates while the menu is open.
  useEffect(() => {
    uiState.saveMenuOpen = saveMenuVisible;
  }, [saveMenuVisible]);

  // Auto-hide toast messages.
  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const id = window.setTimeout(() => setToast(''), 1500);

    return () => window.clearTimeout(id);
  }, [toast]);

  updateInterface.general = (general) => {
    setPortId(general.portId);
    setBuildingId(general.buildingId);
    setTimePassed(general.timePassed);
    setGold(general.gold);
  };

  updateInterface.worldMap = setWorldMap;

  updateInterface.toast = setToast;

  const { fade, onAnimationEnd } = useFade();

  const inPort = portId !== null;

  return (
    <div className="[image-rendering:pixelated]">
      <div className="flex items-stretch">
        <Left
          portId={portId}
          buildingId={buildingId}
          timePassed={timePassed}
          gold={gold}
        >
          <Provisions hidden={inPort} />
        </Left>
        <div
          className={classNames(
            'w-[1280px] h-[800px] relative select-none',
            fade ? 'fade-out' : '',
          )}
          onAnimationEnd={onAnimationEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {buildingId !== null && <Building buildingId={buildingId} />}
          <div className={buildingId ? 'hidden' : ''}>
            <Camera />
          </div>
          {worldMap.visible && (
            <WorldMap
              position={worldMap.position}
              autoNavigation={worldMap.autoNavigation}
            />
          )}
          {!worldMap.visible && !inPort && (
            <AutoNavigationDebugOverlay
              position={worldMap.position}
              autoNavigation={worldMap.autoNavigation}
            />
          )}
          {toast && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-black/80 text-white text-lg whitespace-nowrap pointer-events-none">
              {toast}
            </div>
          )}
          {saveMenuVisible && (
            <SaveMenu onClose={() => setSaveMenuVisible(false)} />
          )}
        </div>
        <Right>
          {inPort && <PortInfo portId={portId} />}
          <Indicators hidden={inPort} />
        </Right>
      </div>
    </div>
  );
}

const renderInterface = () =>
  new Promise<void>((resolve) => {
    const container = document.getElementById('game');
    const root = createRoot(container!);
    root.render(
      <React.StrictMode>
        <Interface resolve={resolve} />
      </React.StrictMode>,
    );
  });

export default renderInterface;

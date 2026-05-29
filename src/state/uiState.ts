/*
  Small bridge between the React interface and the imperative game loop.

  React owns the save menu's visibility, but the game loop in app.ts needs to
  know when it's open so it can pause world/port updates (otherwise the ship
  keeps drifting behind the menu). React writes `saveMenuOpen`; the loop reads
  it.
 */
const uiState = {
  saveMenuOpen: false,
};

export default uiState;

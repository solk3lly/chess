export const BOARD_THEMES = {
  brown: { label: 'Walnut', image: 'brown.png' },
  wood: { label: 'Wood grain', image: 'wood.jpg' },
  blue: { label: 'Blue', image: 'blue.png' },
  green: { label: 'Green', image: 'lila/green.png' },
  purple: { label: 'Purple', image: 'lila/purple.png' },
  ic: { label: 'IC', image: 'lila/ic.png' },
  grey: { label: 'Grey', image: 'lila/grey.jpg' },
  maple: { label: 'Maple', image: 'lila/maple.jpg' },
  marble: { label: 'Marble', image: 'lila/marble.jpg' },
  'blue-marble': { label: 'Blue Marble', image: 'lila/blue-marble.jpg' },
  olive: { label: 'Olive', image: 'lila/olive.jpg' },
  metal: { label: 'Metal', image: 'lila/metal.jpg' },
  'rhosgfx-blue': { label: 'RhosGFX Blue', image: 'rhosgfx/blue.svg' },
  'rhosgfx-brown': { label: 'RhosGFX Brown', image: 'rhosgfx/brown.svg' },
  'rhosgfx-green': { label: 'RhosGFX Green', image: 'rhosgfx/green.svg' },
  jade: { label: 'Jade', image: 'staunton/Jade.png', beveled: true },
  rosewood: { label: 'Rosewood', image: 'staunton/Rosewood.png', beveled: true },
  'china-green': { label: 'China Green', image: 'staunton/China-Green.png', beveled: true },
  'green-glass': { label: 'Green Glass', image: 'staunton/Green-Glass.png', beveled: true },
  'brushed-aluminium': { label: 'Brushed Aluminium', image: 'staunton/Brushed-Aluminium.png', beveled: true },
};

export const PIECE_THEMES = {
  '2d': { label: 'Classic', folder: 'cburnett' },
  '3d': { label: 'Sculpted', folder: 'staunton-basic', rendered: true },
  chessnut: { label: 'Chessnut' },
  spatial: { label: 'Spatial' },
  celtic: { label: 'Celtic' },
  fantasy: { label: 'Fantasy' },
  firi: { label: 'Firi' },
  shapes: { label: 'Shapes' },
  rhosgfx: { label: 'RhosGFX' },
  'rhosgfx-outline': { label: 'RhosGFX Outline' },
  'rhosgfx-wood': { label: 'RhosGFX Wood' },
  'rhosgfx-wood-outline': { label: 'RhosGFX Wood Outline' },
  'rhosgfx-flat': { label: 'RhosGFX Flat' },
  'modern-jade': { label: 'Modern Jade', rendered: true },
  'modern-wood': { label: 'Modern Wood', rendered: true },
  tournament: { label: 'Tournament', rendered: true },
};

const ROLES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

export function pieceImageSrc(theme, color, role) {
  const { folder = theme, rendered } = PIECE_THEMES[theme];
  if (rendered) {
    const side = color === 'white' ? 'White' : 'Black';
    return `./assets/pieces/3d/${folder}/${side}-${ROLES[role]}.png`;
  }
  return `./assets/pieces/2d/${folder}/${color[0]}${role.toUpperCase()}.svg`;
}

export function applyBoardTheme(shell, board, pieces) {
  const texture = BOARD_THEMES[board];
  shell.dataset.boardStyle = board;
  shell.dataset.pieceStyle = pieces;
  shell.classList.toggle('beveled-board', Boolean(texture.beveled));
  shell.classList.toggle('rendered-pieces', Boolean(PIECE_THEMES[pieces].rendered));
  shell.style.setProperty('--board-image', `url("./assets/boards/${texture.image}")`);
  for (const color of ['white', 'black']) {
    for (const [letter, role] of Object.entries(ROLES)) {
      shell.style.setProperty(`--piece-${color}-${role.toLowerCase()}`, `url("${pieceImageSrc(pieces, color, letter)}")`);
    }
  }
}

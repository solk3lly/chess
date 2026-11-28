const replayKeys = {
  ArrowLeft: 'replay-back',
  ArrowRight: 'replay-next',
  Home: 'replay-start',
  End: 'replay-end',
  Escape: 'return-to-game',
};

export const shortcutGroups = [
  {
    label: 'Across the site',
    bindings: [
      ['?', 'shortcuts-open', 'Open shortcut reference'],
      ['s', 'settings-open', 'Open Settings'],
      ['f', 'flip-board', 'Flip board'],
      ['p', 'go-play', 'Open Play'],
      ['r', 'go-review', 'Open Game Review'],
      ['t', 'go-practice', 'Open Practice'],
    ],
  },
  {
    label: 'Play',
    mode: 'play',
    bindings: [
      ['m', 'move-input', 'Enter a move'],
      ['u', 'undo', 'Take back a turn'],
      ['n', 'new-game', 'Start a new game'],
    ],
  },
  {
    label: 'Game Review',
    mode: 'review',
    bindings: [
      ['[', 'previous-moment', 'Previous key decision'],
      [']', 'next-moment', 'Next key decision'],
      [',', 'older-review', 'Older saved game'],
      ['.', 'newer-review', 'Newer saved game'],
    ],
  },
  {
    label: 'Practice',
    mode: 'practice',
    bindings: [
      ['m', 'move-input', 'Enter a move'],
      ['h', 'practice-hint', 'Reveal hint'],
      ['x', 'practice-reset', 'Reset position'],
    ],
  },
];

const editingControls = 'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]';
const navigationControls = '[role="slider"], [role="tablist"]';

export function shortcutAction(event, mode, enabled) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
      event.target?.closest?.(editingControls)) return null;
  if (mode === 'review' && event.key === 'Escape' && !event.shiftKey) return replayKeys.Escape;
  if (mode === 'review' && !event.shiftKey && Object.hasOwn(replayKeys, event.key)) {
    return event.target?.closest?.(navigationControls) ? null : replayKeys[event.key];
  }
  if (!enabled || event.repeat) return null;
  const key = event.key.toLowerCase();
  for (const group of shortcutGroups) {
    if (group.mode && group.mode !== mode) continue;
    const match = group.bindings.find(([binding]) => binding === key);
    if (match) return match[1];
  }
  return null;
}

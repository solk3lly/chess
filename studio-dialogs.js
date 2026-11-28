import { createElement as h, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogTitle, Button, ButtonGroup, Checkbox, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Icon, Label, NativeSelect, NativeSelectOption, Slider,
} from './ui/shadcn.js';
import { renderUI } from './ui/render.js';
import { BOARD_THEMES, PIECE_THEMES, pieceImageSrc } from './board-themes.js';
import { OUTCOME_ICONS } from './icons.js';
import { PRESET_ORDER, REVIEW_PRESETS } from './review.js';
import { BOT_PROFILES, DIFFICULTY_ORDER, LEVELS, botSearchSummary } from './studio-game.js';
import { shortcutGroups } from './keyboard.js';
import { sliderMarkers } from './studio-widgets.js';

let activeDialog = null;

export function isDialogOpen(id) {
  return activeDialog !== null && (id === undefined || activeDialog.id === id);
}

export function closeDialog(id, result) {
  if (activeDialog?.id !== id) return;
  const { resolve, trigger } = activeDialog;
  activeDialog = null;
  renderUI(document.getElementById('studio-dialogs'), null);
  if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({ preventScroll: true });
  resolve(result);
  document.dispatchEvent(new Event('studio-dialog-closed'));
}

function openDialog(id, Content, props, alert = false) {
  if (activeDialog) return Promise.resolve();
  return new Promise(resolve => {
    activeDialog = { id, resolve, trigger: document.activeElement };
    const close = result => closeDialog(id, result);
    renderUI(document.getElementById('studio-dialogs'),
      h(alert ? AlertDialog : Dialog, { open: true, onOpenChange: open => { if (!open) close(); } },
        h(Content, { id, close, ...props })));
  });
}

function CloseButton({ close, label }) {
  return h(Button, { type: 'button', variant: 'ghost', size: 'icon', onClick: () => close(), 'aria-label': label },
    h(Icon, { name: 'x' }));
}

function SelectField({ name, label, options, value, autoFocus, onChange }) {
  const fullWidth = name === 'bot' || name === 'board' || name === 'pieces';
  return h('div', { className: fullWidth ? 'field settings-wide' : 'field' },
    h(Label, { htmlFor: 'settings-' + name }, label),
    h(NativeSelect, { name, id: 'settings-' + name, defaultValue: value, autoFocus, onChange },
      options.map(([key, text]) => h(NativeSelectOption, { key, value: key }, text))));
}

const botField = ['bot', 'Bot profile', Object.entries(BOT_PROFILES).map(([key, bot]) => [
  key, key === 'default' ? `Default (${bot.label})` : bot.listLabel,
])];

const settingsFields = [
  ['color', 'Play as', [['white', 'White'], ['black', 'Black']]],
  ['theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]],
  ['board', 'Board', Object.entries(BOARD_THEMES).map(([key, theme]) => [key, theme.label])],
  ['pieces', 'Pieces', Object.entries(PIECE_THEMES).map(([key, theme]) => [key, theme.label])],
  ['reviewPreset', 'Review depth', PRESET_ORDER.map(key => [key, REVIEW_PRESETS[key].label])],
  ['maiaReview', 'Maia-3 insights', [
    ['ask', 'Ask first'],
    ['enabled', 'On (~22 MB)'],
    ['disabled', 'Off'],
  ]],
];

function SettingsDifficulty({ index, setIndex, bot }) {
  const difficulty = DIFFICULTY_ORDER[index];
  const label = LEVELS[difficulty].label;
  const summary = botSearchSummary(difficulty, bot);
  return h('div', { className: 'field settings-difficulty' },
    h('div', { className: 'settings-difficulty-head' },
      h(Label, { htmlFor: 'settings-difficulty-slider' }, 'Bot difficulty'),
      h('strong', { className: 'difficulty-inline-label' }, label)),
    h(Slider, {
      thumbId: 'settings-difficulty-slider', label: 'Bot difficulty', valueText: `${label}, ${summary}`,
      min: 0, max: DIFFICULTY_ORDER.length - 1, step: 1, value: [index],
      onValueChange: ([next]) => setIndex(next), markers: sliderMarkers(DIFFICULTY_ORDER.length, index),
    }),
    h('input', { type: 'hidden', name: 'difficulty', value: difficulty }),
    h('div', { className: 'stepped-slider-labels', 'aria-hidden': true },
      DIFFICULTY_ORDER.map(key => h('span', { key }, LEVELS[key].label))),
    h('small', { className: 'muted' }, summary));
}

function SettingsContent({ id, close, initial }) {
  const [index, setIndex] = useState(DIFFICULTY_ORDER.indexOf(initial.difficulty));
  const [bot, setBot] = useState(initial.bot);
  function save(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    close({ ...Object.fromEntries(data), sound: data.has('sound'), shortcuts: data.has('shortcuts') });
  }
  const field = ([name, label, options]) => h(SelectField, {
    key: name, name, label, options, value: initial[name], autoFocus: name === 'color',
    onChange: name === 'bot' ? event => setBot(event.target.value) : undefined,
  });
  return h(DialogContent, { id },
    h('form', { onSubmit: save },
      h(DialogHeader, { className: 'dialog-heading' },
        h(DialogTitle, null, 'Settings'), h(CloseButton, { close, label: 'Close settings' })),
      h(DialogDescription, null, 'Preferences stay in this browser. Review depth applies the next time you analyze a game. Side color applies to your next game.'),
      h('div', { className: 'settings-grid' },
        field(botField),
        h(SettingsDifficulty, { index, setIndex, bot }),
        settingsFields.map(field),
        h('div', { className: 'check-field settings-wide' },
          h(Checkbox, { id: 'settings-sound', name: 'sound', defaultChecked: initial.sound }),
          h(Label, { htmlFor: 'settings-sound' }, h(Icon, { name: 'speaker-high' }), 'Move sounds')),
        h('div', { className: 'check-field settings-wide' },
          h(Checkbox, { id: 'settings-shortcuts', name: 'shortcuts', defaultChecked: initial.shortcuts }),
          h(Label, { htmlFor: 'settings-shortcuts' }, 'Enable additional keyboard shortcuts'))),
      h(DialogFooter, null, h(Button, { type: 'submit' }, h(Icon, { name: 'check' }), 'Save settings'))));
}

function ConfirmContent({ id, close, title, description, label }) {
  return h(AlertDialogContent, { id },
    h(DialogHeader, null, h(AlertDialogTitle, null, title), h(AlertDialogDescription, null, description)),
    h(DialogFooter, { className: 'action-row' },
      h(AlertDialogCancel, { onClick: () => close(false) }, 'Cancel'),
      h(AlertDialogAction, { onClick: () => close(true) }, label)));
}

function DrawClaimContent({ id, close, moves }) {
  return h(DialogContent, { id },
    h('form', { onSubmit: event => {
      event.preventDefault();
      close(new FormData(event.currentTarget).get('intendedMove'));
    } },
    h(DialogHeader, { className: 'dialog-heading' },
      h(DialogTitle, null, 'Claim a draw'), h(CloseButton, { close, label: 'Cancel draw claim' })),
    h(DialogDescription, null, 'Choose the move that would qualify. A successful claim ends the game before that move is played.'),
    h(SelectField, { name: 'intendedMove', label: 'Intended move', value: moves[0].uci,
      options: moves.map(move => [move.uci, `${move.san} · ${move.reason}`]) }),
    h(DialogFooter, { className: 'action-row' },
      h(Button, { type: 'submit' }, 'Claim draw'))));
}

const promotions = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

function PromotionContent({ id, close, color, pieces }) {
  return h(DialogContent, { id },
    h(DialogHeader, { className: 'dialog-heading' },
      h(DialogTitle, null, 'Promote pawn'), h(CloseButton, { close, label: 'Cancel promotion' })),
    h(DialogDescription, { className: 'sr-only' }, 'Choose the piece to replace your pawn.'),
    h(ButtonGroup, { className: 'action-row promotion-actions' },
      Object.entries(promotions).map(([key, label]) => h(Button, {
        key, variant: 'outline', className: 'promotion-option', autoFocus: key === 'q', onClick: () => close(key),
      }, h('img', { className: 'promotion-piece', src: pieceImageSrc(pieces, color, key), alt: '' }), label))));
}

function GameOverContent({ id, close, title, reason, outcome, openReview, retry }) {
  return h(DialogContent, { id, className: 'game-over-dialog' },
    h(DialogHeader, { className: 'dialog-heading' },
      h('div', null,
        h(DialogTitle, { className: 'game-over-title-row' },
          h('span', { id: 'game-over-icon', className: 'outcome-icon', 'data-outcome': outcome },
            h(Icon, { name: OUTCOME_ICONS[outcome] })), title),
        h(DialogDescription, null, reason)),
      h(CloseButton, { close, label: 'Close game results' })),
    h('section', { className: 'game-over-analysis', 'aria-labelledby': 'game-over-analysis-title' },
      h('h3', { id: 'game-over-analysis-title' }, 'Your moves'),
      h('dl', { id: 'game-over-counts', className: 'game-over-counts' }),
      h('p', { id: 'game-over-status', className: 'muted', role: 'status' })),
    h(DialogFooter, { className: 'action-row' },
      h(Button, { onClick: openReview, autoFocus: true }, h(Icon, { name: 'magnifying-glass' }), 'Game Review'),
      h(Button, { id: 'game-over-retry', variant: 'outline', onClick: retry, hidden: true },
        h(Icon, { name: 'arrow-clockwise' }), 'Retry analysis')));
}

function ShortcutsContent({ id, close, enabled }) {
  return h(DialogContent, { id, className: 'shortcuts-dialog' },
    h(DialogHeader, { className: 'dialog-heading' },
      h(DialogTitle, null, 'Keyboard shortcuts'), h(CloseButton, { close, label: 'Close keyboard shortcuts' })),
    h(DialogDescription, null, enabled
      ? 'Use Tab to reach controls and Enter or Space to activate them.'
      : 'Additional shortcuts are off. You can turn them on in Settings.'),
    h('p', { className: 'shortcuts-note' },
      'In Review, use ', h('kbd', null, '←'), ' and ', h('kbd', null, '→'),
      ' to step through a line, ', h('kbd', null, 'Home'), ' and ', h('kbd', null, 'End'),
      ' to jump to its ends, and ', h('kbd', null, 'Esc'), ' to return to the game.'),
    enabled && shortcutGroups.map(({ label, bindings }) => h('section', { key: label, className: 'shortcut-group' },
      h('h3', null, label),
      h('dl', { className: 'shortcut-list' }, bindings.map(([key, action, description]) =>
        h('div', { key: action }, h('dt', null, h('kbd', null, key.toUpperCase())), h('dd', null, description)))))));
}

export const showShortcutsDialog = enabled => openDialog('shortcuts-dialog', ShortcutsContent, { enabled });
export const showSettingsDialog = initial => openDialog('settings-dialog', SettingsContent, { initial });
export const confirmAction = (title, description, label) => openDialog('confirm-dialog', ConfirmContent, { title, description, label }, true);
export const chooseDrawMove = moves => openDialog('draw-claim-dialog', DrawClaimContent, { moves });
export const choosePromotion = (color, pieces) => openDialog('promotion-dialog', PromotionContent, { color, pieces });
export const showGameOverDialog = props => openDialog('game-over-dialog', GameOverContent, props);

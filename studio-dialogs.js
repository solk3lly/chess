import { createElement as h, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogTitle, Button, ButtonGroup, Checkbox, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Icon, Label, NativeSelect, NativeSelectOption, Slider,
} from './ui/shadcn.js';
import { renderUI } from './ui/render.js';
import { OUTCOME_ICONS, promotionPieceSrc } from './icons.js';
import { BOT_PROFILES, DIFFICULTY_ORDER, LEVELS } from './studio-game.js';
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

function SelectField({ name, label, options, value, autoFocus }) {
  return h('div', { className: name === 'bot' ? 'field settings-bot' : 'field' },
    h(Label, { htmlFor: 'settings-' + name }, label),
    h(NativeSelect, { name, id: 'settings-' + name, defaultValue: value, autoFocus },
      options.map(([key, text]) => h(NativeSelectOption, { key, value: key }, text))));
}

const botField = ['bot', 'Bot profile', Object.entries(BOT_PROFILES).map(([key, bot]) => [
  key, key === 'default' ? `Default (${bot.label})` : bot.listLabel,
])];

const settingsFields = [
  ['color', 'Play as', [['white', 'White'], ['black', 'Black']]],
  ['theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]],
  ['board', 'Board', [['brown', 'Walnut'], ['wood', 'Wood grain'], ['blue', 'Blue']]],
  ['pieces', 'Pieces', [['2d', 'Classic'], ['3d', 'Sculpted']]],
];

function SettingsDifficulty({ index, setIndex }) {
  const difficulty = DIFFICULTY_ORDER[index];
  const label = LEVELS[difficulty].label;
  return h('div', { className: 'field settings-difficulty' },
    h('div', { className: 'settings-difficulty-head' },
      h(Label, { htmlFor: 'settings-difficulty-slider' }, 'Bot difficulty'),
      h('strong', { className: 'difficulty-inline-label' }, label)),
    h(Slider, {
      thumbId: 'settings-difficulty-slider', label: 'Bot difficulty', valueText: label,
      min: 0, max: DIFFICULTY_ORDER.length - 1, step: 1, value: [index],
      onValueChange: ([next]) => setIndex(next), markers: sliderMarkers(DIFFICULTY_ORDER.length, index),
    }),
    h('input', { type: 'hidden', name: 'difficulty', value: difficulty }),
    h('div', { className: 'stepped-slider-labels', 'aria-hidden': true },
      DIFFICULTY_ORDER.map(key => h('span', { key }, LEVELS[key].label))));
}

function SettingsContent({ id, close, initial }) {
  const [index, setIndex] = useState(DIFFICULTY_ORDER.indexOf(initial.difficulty));
  function save(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    close({ ...Object.fromEntries(data), sound: data.has('sound') });
  }
  const field = ([name, label, options]) => h(SelectField, {
    key: name, name, label, options, value: initial[name], autoFocus: name === 'color',
  });
  return h(DialogContent, { id },
    h('form', { onSubmit: save },
      h(DialogHeader, { className: 'dialog-heading' },
        h(DialogTitle, null, 'Settings'), h(CloseButton, { close, label: 'Close settings' })),
      h(DialogDescription, null, 'Preferences stay in this browser. Bot settings update immediately; side color applies to your next game.'),
      h('div', { className: 'settings-grid' },
        field(botField),
        h(SettingsDifficulty, { index, setIndex }),
        settingsFields.map(field),
        h('div', { className: 'check-field' },
          h(Checkbox, { id: 'settings-sound', name: 'sound', defaultChecked: initial.sound }),
          h(Label, { htmlFor: 'settings-sound' }, h(Icon, { name: 'speaker-high' }), 'Move sounds'))),
      h(DialogFooter, null, h(Button, { type: 'submit' }, h(Icon, { name: 'check' }), 'Save settings'))));
}

function ConfirmContent({ id, close, title, description, label }) {
  return h(AlertDialogContent, { id },
    h(DialogHeader, null, h(AlertDialogTitle, null, title), h(AlertDialogDescription, null, description)),
    h(DialogFooter, { className: 'action-row' },
      h(AlertDialogCancel, { onClick: () => close(false) }, 'Cancel'),
      h(AlertDialogAction, { onClick: () => close(true) }, label)));
}

const promotions = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

function PromotionContent({ id, close, color }) {
  return h(DialogContent, { id },
    h(DialogHeader, { className: 'dialog-heading' },
      h(DialogTitle, null, 'Promote pawn'), h(CloseButton, { close, label: 'Cancel promotion' })),
    h(DialogDescription, { className: 'sr-only' }, 'Choose the piece to replace your pawn.'),
    h(ButtonGroup, { className: 'action-row promotion-actions' },
      Object.entries(promotions).map(([key, label]) => h(Button, {
        key, variant: 'outline', className: 'promotion-option', autoFocus: key === 'q', onClick: () => close(key),
      }, h('img', { className: 'promotion-piece', src: promotionPieceSrc(color, key), alt: '' }), label))));
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

export const showSettingsDialog = initial => openDialog('settings-dialog', SettingsContent, { initial });
export const confirmAction = (title, description, label) => openDialog('confirm-dialog', ConfirmContent, { title, description, label }, true);
export const choosePromotion = color => openDialog('promotion-dialog', PromotionContent, { color });
export const showGameOverDialog = props => openDialog('game-over-dialog', GameOverContent, props);

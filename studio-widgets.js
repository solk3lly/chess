import { createElement as h, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Popover, PopoverContent, PopoverTrigger, Progress, Slider, Tabs } from './ui/shadcn.js';
import { renderUI, unmountUI } from './ui/render.js';
import { byId } from './studio-view.js';

let setReviewTab;
let setPickerOpen;
let pickerChange = () => {};

export function ReviewTabs({ children }) {
  const [value, setValue] = useState('inspect');
  useLayoutEffect(() => {
    setReviewTab = setValue;
  }, []);
  return h(Tabs, { value, onValueChange: setValue }, children);
}

export function activateReviewTab(name, focus = false) {
  flushSync(() => setReviewTab(name));
  if (focus) document.querySelector(`[data-review-tab="${name}"]`).focus({ preventScroll: true });
}

export function DifficultyPicker({ children }) {
  const [open, setOpen] = useState(false);
  const [trigger, ...content] = children;
  useLayoutEffect(() => {
    setPickerOpen = changeOpen;
  }, []);
  function changeOpen(next) {
    if (!next) unmountUI(document.getElementById('difficulty-slider-shell'));
    flushSync(() => setOpen(next));
    pickerChange(next);
  }
  return h('div', { id: 'difficulty-picker', className: 'difficulty-picker' },
    h(Popover, { open, onOpenChange: changeOpen },
      h(PopoverTrigger, { asChild: true }, trigger),
      h(PopoverContent, {
        id: 'difficulty-popover', className: 'difficulty-popover', 'aria-label': 'Bot difficulty',
        align: 'end', sideOffset: 8, collisionPadding: 10,
        onEscapeKeyDown: event => {
          if (byId('difficulty-popover').dataset.view !== 'bots') return;
          event.preventDefault();
          byId('difficulty-bot-back').click();
        },
        onOpenAutoFocus: event => {
          event.preventDefault();
          requestAnimationFrame(() => document.getElementById('difficulty-slider')?.focus({ preventScroll: true }));
        },
      }, ...content)));
}

export function bindDifficultyPicker(onChange) {
  pickerChange = onChange;
}

export function closeDifficultyPopover() {
  const trigger = document.getElementById('difficulty-trigger');
  if (trigger.dataset.state !== 'open') return;
  setPickerOpen(false);
}

export function renderSlider(shell, { value, onValueChange, onValueCommit, ...props }) {
  renderUI(shell, h(Slider, {
    value: [value], onValueChange: onValueChange && (([next]) => onValueChange(next)),
    onValueCommit: onValueCommit && (([next]) => onValueCommit(next)), ...props,
  }));
}

export function sliderMarkers(count, value) {
  return Array.from({ length: count }, (_, index) => h('span', {
    key: index, 'aria-hidden': true, className: 'slider-marker', 'data-filled': index <= value,
    style: { left: `${100 * index / (count - 1)}%` },
  }));
}

export function renderProgress(id, value, max) {
  renderUI(byId(id), h(Progress, { value, max, 'aria-label': 'Moves analyzed' }));
}

export function renderReplay(ply, total, onValueChange) {
  renderSlider(byId('replay-slider'), {
    value: ply, max: Math.max(1, total), step: 1, disabled: total === 0,
    thumbId: 'replay-ply', label: 'Replay position', valueText: `Position ${ply} of ${total}`, onValueChange,
  });
  for (const id of ['replay-start', 'replay-back']) byId(id).disabled = ply === 0;
  for (const id of ['replay-end', 'replay-next']) byId(id).disabled = ply === total;
}

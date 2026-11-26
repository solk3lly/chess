// Browser adaptation of the shadcn/ui New York registry (MIT).
import { createElement as h } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Slot } from '@radix-ui/react-slot';
import { ICON_SPRITE } from '../icons.js';
import { buttonAttributes } from './button.js';

function part(Tag, slot) {
  return function Part(props) {
    return h(Tag, { 'data-slot': slot, ...props });
  };
}

export function Icon({ name, className = 'icon' }) {
  return h('svg', { className, viewBox: '0 0 256 256', 'aria-hidden': true, focusable: false },
    h('use', { href: ICON_SPRITE + '#ph-' + name }));
}

export function Button({ asChild = false, variant = 'default', size = 'default', type, ...props }) {
  return h(asChild ? Slot : 'button', {
    ...buttonAttributes(variant, size),
    type: asChild ? type : type ?? 'button', ...props,
  });
}

export const Card = part('section', 'card');
export const CardHeader = part('header', 'card-header');
export const CardContent = part('div', 'card-content');
export const CardTitle = part('h1', 'card-title');
export const CardDescription = part('p', 'card-description');
export const Badge = part('span', 'badge');
export const Input = part('input', 'input');
export const Label = part('label', 'label');
export const Alert = part('div', 'alert');
export const AlertDescription = part('p', 'alert-description');
export function ButtonGroup(props) {
  return h('div', { 'data-slot': 'button-group', role: 'group', ...props });
}

export function NativeSelect({ className, ...props }) {
  return h('div', { 'data-slot': 'native-select-wrapper', className },
    h('select', { 'data-slot': 'native-select', ...props }),
    h(Icon, { name: 'caret-left', className: 'native-select-icon' }));
}
export const NativeSelectOption = part('option', 'native-select-option');

export const Dialog = DialogPrimitive.Root;
export const DialogHeader = part('header', 'dialog-header');
export const DialogFooter = part('div', 'dialog-footer');
export const DialogTitle = part(DialogPrimitive.Title, 'dialog-title');
export const DialogDescription = part(DialogPrimitive.Description, 'dialog-description');

export function DialogContent(props) {
  return h(DialogPrimitive.Portal, null,
    h(DialogPrimitive.Overlay, { 'data-slot': 'dialog-overlay' }),
    h(DialogPrimitive.Content, { 'data-slot': 'dialog-content', ...props }));
}

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTitle = part(AlertDialogPrimitive.Title, 'alert-dialog-title');
export const AlertDialogDescription = part(AlertDialogPrimitive.Description, 'alert-dialog-description');

export function AlertDialogContent(props) {
  return h(AlertDialogPrimitive.Portal, null,
    h(AlertDialogPrimitive.Overlay, { 'data-slot': 'alert-dialog-overlay' }),
    h(AlertDialogPrimitive.Content, { 'data-slot': 'alert-dialog-content', ...props }));
}

export function AlertDialogCancel(props) {
  return h(AlertDialogPrimitive.Cancel, { asChild: true }, h(Button, { variant: 'outline', ...props }));
}

export function AlertDialogAction(props) {
  return h(AlertDialogPrimitive.Action, { asChild: true }, h(Button, props));
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = part(PopoverPrimitive.Trigger, 'popover-trigger');
export function PopoverContent({ forceMount, ...props }) {
  return h(PopoverPrimitive.Portal, { forceMount },
    h(PopoverPrimitive.Content, { 'data-slot': 'popover-content', forceMount, ...props }));
}
export const Tabs = part(TabsPrimitive.Root, 'tabs');
export const TabsList = part(TabsPrimitive.List, 'tabs-list');
export const TabsTrigger = part(TabsPrimitive.Trigger, 'tabs-trigger');
export const TabsContent = part(TabsPrimitive.Content, 'tabs-content');

export function Slider({ thumbId, valueText, label, value, markers = [], ...props }) {
  return h(SliderPrimitive.Root, { 'data-slot': 'slider', value, ...props },
    h(SliderPrimitive.Track, { 'data-slot': 'slider-track' },
      h(SliderPrimitive.Range, { 'data-slot': 'slider-range' }),
      markers),
    h(SliderPrimitive.Thumb, {
      'data-slot': 'slider-thumb', id: thumbId, 'aria-label': label, 'aria-valuetext': valueText,
    }));
}

export function Progress({ value = 0, max = 100, ...props }) {
  return h(ProgressPrimitive.Root, { 'data-slot': 'progress', value, max, ...props },
    h(ProgressPrimitive.Indicator, {
      'data-slot': 'progress-indicator', style: { transform: `translateX(-${100 - value * 100 / max}%)` },
    }));
}

export function Checkbox(props) {
  return h(CheckboxPrimitive.Root, { 'data-slot': 'checkbox', ...props },
    h(CheckboxPrimitive.Indicator, { 'data-slot': 'checkbox-indicator' }, h(Icon, { name: 'check' })));
}

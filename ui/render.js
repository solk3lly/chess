import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const roots = new WeakMap();

export function renderUI(container, content) {
  if (!roots.has(container)) roots.set(container, createRoot(container));
  flushSync(() => roots.get(container).render(content));
}

export function unmountUI(container) {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}

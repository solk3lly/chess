import test from 'node:test';
import assert from 'node:assert/strict';

const keyboard = await import('../keyboard.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

test('new shortcuts stay scoped and can be turned off', () => {
  assert.equal(typeof keyboard.shortcutAction, 'function');
  assert.equal(keyboard.shortcutAction({ key: 'h' }, 'practice', true), 'practice-hint');
  assert.equal(keyboard.shortcutAction({ key: 'h' }, 'play', true), null);
  assert.equal(keyboard.shortcutAction({ key: 'h' }, 'practice', false), null);
  assert.equal(keyboard.shortcutAction({ key: 'ArrowLeft' }, 'review', false), 'replay-back');
});

test('shortcuts leave text entry and system bindings alone', () => {
  assert.equal(typeof keyboard.shortcutAction, 'function');
  assert.equal(keyboard.shortcutAction({ key: 'f', ctrlKey: true }, 'review', true), null);
  assert.equal(keyboard.shortcutAction({ key: 'f', target: { closest: () => true } }, 'play', true), null);
  assert.equal(keyboard.shortcutAction({ key: 'f', defaultPrevented: true }, 'play', true), null);
});

test('Escape can exit a variation from the replay slider', () => {
  const target = { closest: selector => selector.includes('[role="slider"]') };
  assert.equal(keyboard.shortcutAction({ key: 'Escape', target }, 'review', true), 'return-to-game');
  assert.equal(keyboard.shortcutAction({ key: 'ArrowLeft', target }, 'review', true), null);
});

test('archive shortcuts remain available from the replay slider', () => {
  const target = { closest: selector => selector.includes('[role="slider"]') };
  assert.equal(keyboard.shortcutAction({ key: ',', target }, 'review', true), 'older-review');
});

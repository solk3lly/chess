export function buttonAttributes(variant = 'default', size = 'default') {
  return { 'data-slot': 'button', 'data-variant': variant, 'data-size': size };
}

export function applyButtonVariant(button, variant, size) {
  for (const [name, value] of Object.entries(buttonAttributes(variant, size))) {
    button.setAttribute(name, value);
  }
}

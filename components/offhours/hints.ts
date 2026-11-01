// On a touch screen the keyboard half of a hint is noise: drop "(or Space)", "(keys 1-7)", "(keyboard: ...)" and
// keyboard-only lines ("Keyboard: ..."), and say tap instead of click.
export function forTouch(how: string[]) {
  return how.filter((h) => !h.startsWith("Keyboard:")).map((h) => h.replace(/\s*\((?:or |keys |keyboard)[^)]*\)/gi, "").replace(/^Click/, "Tap"));
}

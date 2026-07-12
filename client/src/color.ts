const UI_INK = '#22252e';
const UI_WHITE = '#fffdf5';

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) throw new Error(`Unsupported color: ${hex}`);
  return [0, 2, 4].map(index => Number.parseInt(clean.slice(index, index + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

export function readableTextColor(background: string): string {
  return contrastRatio(background, UI_INK) >= contrastRatio(background, UI_WHITE) ? UI_INK : UI_WHITE;
}

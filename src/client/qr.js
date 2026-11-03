import { h } from "preact";
import { useMemo } from "preact/hooks";
import htm from "htm";
import qrcode from "qrcode-generator";

const html = htm.bind(h);

export function QR({ text, label, size = 176 }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [text]);
  return html`<div class="qr" role="img" aria-label=${label} style=${`width:${size}px;height:${size}px`} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

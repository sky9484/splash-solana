'use client';
// copy: technical
// "How to check this receipt" (prompt 12 §5.4): the proof's fingerprint and root are identifiers an auditor
// needs verbatim, so this block is marked technical for check-jargon, like Technical details.

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { MytDate } from './Myt';

/**
 * The QR is drawn in the browser from the share link itself (the qrcode package, no outside service),
 * and only when a share exists: printing never makes a link by itself. The company's own copy without a
 * share says how to make one.
 */
export function ReceiptCheck({ shareUrl, recordedAt, fingerprint, root }: { shareUrl: string | null; recordedAt: string | null; fingerprint: string; root: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!shareUrl) return;
    let live = true;
    // The ink and white tokens of the .iso scope (styles/tokens.css); margin 0, the box gives the quiet zone.
    const tokens = box.current ? getComputedStyle(box.current) : null;
    const dark = tokens?.getPropertyValue('--ink-deep').trim() || undefined;
    const light = tokens?.getPropertyValue('--white').trim() || undefined;
    QRCode.toString(shareUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark, light } })
      .then((s) => {
        if (live) setSvg(s);
      })
      .catch(() => {
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, [shareUrl]);

  return (
    <section ref={box} className="iso-a4__check" aria-labelledby="doc-check">
      {shareUrl ? (
        svg ? (
          // The SVG is the qrcode package's output for our own link: no outside markup reaches it.
          <span className="iso-a4__qr" role="img" aria-label="QR code that opens this receipt to verify it" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="iso-a4__qr" aria-hidden="true" />
        )
      ) : null}
      <div>
        <h3 id="doc-check" className="iso-a4__h3">
          How to check this receipt
        </h3>
        {shareUrl ? (
          <p className="iso-a4__p">
            Scan, or open <span className="iso-mono iso-a4__url">{shareUrl}</span>. Your browser recomputes the payment’s fingerprint and checks it against the proof recorded
            {recordedAt ? (
              <>
                {' '}
                on <MytDate at={recordedAt} />
              </>
            ) : null}
            . If any field on this page was changed, the check fails. The server supplies the record, never the answer.
          </p>
        ) : (
          <p className="iso-a4__p">
            To let someone outside your company check this receipt, use Share with auditor. Their browser recomputes the payment’s fingerprint and checks it against the proof
            recorded for it. The server supplies the record, never the answer.
          </p>
        )}
        <p className="iso-a4__ids">
          <span>
            fingerprint <span className="iso-mono">{fingerprint}</span>
          </span>
          <span>
            root <span className="iso-mono">{root}</span>
          </span>
        </p>
      </div>
    </section>
  );
}

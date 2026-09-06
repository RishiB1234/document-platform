import { useEffect, useRef, type ReactNode } from "react";

/**
 * A modal built on the native `<dialog>` element.
 *
 * `showModal()` is what earns this: focus moves into the dialog and is trapped
 * there, the rest of the page becomes inert, Escape closes, and the backdrop is
 * the browser's. Reimplementing any of that by hand is how focus ends up
 * stranded behind an overlay.
 *
 * The previous editing surfaces rendered as blocks at the top of the page, so
 * acting on a row far down the table opened a form two screens above it -- on a
 * phone it looked as though the button had done nothing.
 *
 * Opened from an effect rather than by rendering the `open` attribute, because
 * only `showModal()` gives the top layer and the focus trap; the attribute
 * alone renders a non-modal dialog with neither.
 */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={label}
      // Escape fires `cancel`, which would close the dialog without telling
      // React. Routing it through onClose keeps the element and the state that
      // decides whether to render it from disagreeing.
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      // A click that lands on the dialog itself rather than its contents is a
      // click on the backdrop.
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
    >
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

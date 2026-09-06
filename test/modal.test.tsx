// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "../src/ui/Modal.js";

/*
 * The whole value of this component is `showModal()` rather than the `open`
 * attribute: the top layer, the focus trap, the inert page behind, the
 * browser's own backdrop. None of that is observable in rendered markup, so
 * before jsdom there was no way to tell the two apart -- and the difference is
 * exactly the accessibility bug the component exists to avoid.
 *
 * jsdom does not implement the dialog element's behaviour, only its API, so
 * these tests assert that the right calls are made. Whether focus is genuinely
 * trapped is a browser's business.
 */

let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
  HTMLDialogElement.prototype.close = close as unknown as () => void;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dialog = () => screen.getByRole("dialog", { hidden: true });

describe("Modal", () => {
  it("opens as a true modal, not as an open attribute", () => {
    render(<Modal label="Edit week" onClose={vi.fn()}><p>contents</p></Modal>);
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByText("contents")).toBeDefined();
  });

  it("carries its label for assistive technology", () => {
    render(<Modal label="Edit week" onClose={vi.fn()}><p>contents</p></Modal>);
    expect(dialog().getAttribute("aria-label")).toBe("Edit week");
  });

  it("does not reopen a dialog that is already open", () => {
    const { rerender } = render(<Modal label="Edit" onClose={vi.fn()}><p>a</p></Modal>);
    rerender(<Modal label="Edit" onClose={vi.fn()}><p>b</p></Modal>);
    expect(showModal).toHaveBeenCalledOnce();
  });

  /*
   * Escape fires `cancel`, which closes the element directly. Left alone, the
   * dialog would be shut while the state that decides whether to render it
   * still says open -- after which reopening does nothing, because React sees
   * no change.
   */
  it("routes Escape through onClose instead of letting the element close itself", () => {
    const onClose = vi.fn();
    render(<Modal label="Edit" onClose={onClose}><p>a</p></Modal>);

    const cancel = new Event("cancel", { cancelable: true, bubbles: true });
    fireEvent(dialog(), cancel);

    expect(onClose).toHaveBeenCalledOnce();
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<Modal label="Edit" onClose={onClose}><p>contents</p></Modal>);
    fireEvent.click(dialog());
    expect(onClose).toHaveBeenCalledOnce();
  });

  /*
   * A click inside the form is not a backdrop click. Getting this wrong closes
   * the dialog the moment anyone touches a field.
   */
  it("stays open when the click lands on its contents", () => {
    const onClose = vi.fn();
    render(<Modal label="Edit" onClose={onClose}><button type="button">Save</button></Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the dialog when unmounted while open", () => {
    const { unmount } = render(<Modal label="Edit" onClose={vi.fn()}><p>a</p></Modal>);
    unmount();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not close a dialog that is already shut", () => {
    const { unmount } = render(<Modal label="Edit" onClose={vi.fn()}><p>a</p></Modal>);
    dialog().removeAttribute("open");
    unmount();
    expect(close).not.toHaveBeenCalled();
  });
});

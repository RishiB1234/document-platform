// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveReviewPanel, explainRefusal } from "../src/editing/SaveReviewPanel.js";
import { ChangeSummaryList } from "../src/editing/ChangeSummaryList.js";
import { EditingStatusBar } from "../src/editing/EditingStatusBar.js";
import { NothingToSave, UnrecordedMutation } from "../src/editing/prepareSave.js";
import type { ChangeDescription } from "../src/editing/ChangeDescription.js";

/*
 * These components carry a platform guarantee, not just markup: the refusal
 * wording is the platform's, because an application writing its own would be
 * writing a second definition of when a save is allowed. That makes the mapping
 * from refusal type to explanation worth testing.
 */

const describeChange = (title: string, fields: string[] = []): ChangeDescription => ({ title, fields });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("explainRefusal", () => {
  it("says the store will not be contacted when there is nothing to save", () => {
    expect(explainRefusal(new NothingToSave("cancelled-out")))
      .toBe("The recorded changes cancel each other out. The store would not be contacted.");
  });

  /*
   * The one refusal a person cannot fix by editing differently: the working
   * copy and its recorded changes disagree, so the advice has to be to discard
   * and redo rather than to try again.
   */
  it("tells the reader to discard and redo when the candidate was mutated unrecorded", () => {
    const explanation = explainRefusal(new UnrecordedMutation());
    expect(explanation).toMatch(/does not match a replay of its own recorded changes/);
    expect(explanation).toMatch(/Discard the pending changes and redo/);
  });

  it("passes an ordinary validation failure through in its own words", () => {
    expect(explainRefusal(new Error("weeks: must not be empty"))).toBe("weeks: must not be empty");
  });

  it("still says something useful when the failure is not an Error", () => {
    expect(explainRefusal("a bare string")).toBe("This edit cannot be prepared for saving.");
  });
});

describe("SaveReviewPanel", () => {
  const base = { candidateBytes: 11249, recordedCount: 5, error: null, onCancel: vi.fn() };

  /*
   * Reviewing the squashed list rather than the recorded one is the point: five
   * keystroke-saves to one week are one change to the document, and reviewing
   * the raw list would review an edit that is not the one being performed.
   */
  it("counts recorded edits and the changes they reduce to", () => {
    render(<SaveReviewPanel {...base} descriptions={[describeChange("Week ending 2026-08-29")]} />);
    expect(screen.getByText(/5 recorded edits reduce to 1 change/)).toBeDefined();
    expect(screen.getByText(/11,249 bytes of validated JSON/)).toBeDefined();
  });

  it("uses singular wording for a single recorded edit", () => {
    render(<SaveReviewPanel {...base} recordedCount={1} descriptions={[describeChange("One"), describeChange("Two")]} />);
    expect(screen.getByText(/1 recorded edit reduce to 2 changes/)).toBeDefined();
  });

  it("omits the byte count when there is none to state", () => {
    render(<SaveReviewPanel {...base} candidateBytes={null} descriptions={[describeChange("One")]} />);
    expect(screen.queryByText(/bytes of validated JSON/)).toBeNull();
  });

  /*
   * Disabled rather than hidden. The reason a save is unavailable is the useful
   * part, and it is stated in the same panel.
   */
  it("offers a disabled save when there is no plan, alongside the reason", () => {
    render(<SaveReviewPanel {...base} descriptions={null} error={new NothingToSave("no-changes")} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save to the store" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/no recorded changes/);
  });

  it("enables the save once a plan exists, and reports the click", () => {
    const onSave = vi.fn();
    render(<SaveReviewPanel {...base} descriptions={[describeChange("One")]} onSave={onSave} />);
    const button = screen.getByRole("button", { name: "Save to the store" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("blocks a second click while a save is running", () => {
    render(<SaveReviewPanel {...base} descriptions={[describeChange("One")]} onSave={vi.fn()} busy />);
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  /*
   * Read-only viewers get the same review, with no save offered -- so the
   * dismissal has to read as closing rather than as abandoning an edit.
   */
  it("says Close rather than Cancel when no save is on offer", () => {
    const onCancel = vi.fn();
    render(<SaveReviewPanel {...base} onCancel={onCancel} descriptions={[describeChange("One")]} />);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a notice without treating it as a failure", () => {
    render(<SaveReviewPanel {...base} descriptions={[describeChange("One")]} notice="Read-only: sign in to edit." />);
    expect(screen.getByText("Read-only: sign in to edit.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ChangeSummaryList", () => {
  it("lists each change and the fields it touches", () => {
    render(<ChangeSummaryList descriptions={[describeChange("Week ending 2026-08-29", ["steps", "note"])]} />);
    expect(screen.getByText("Week ending 2026-08-29")).toBeDefined();
    expect(screen.getByText("steps")).toBeDefined();
    expect(screen.getByText("note")).toBeDefined();
  });

  it("omits the field list for a change that names none", () => {
    const { container } = render(<ChangeSummaryList descriptions={[describeChange("Deleted a session")]} />);
    expect(container.querySelector(".pending-fields")).toBeNull();
  });
});

describe("EditingStatusBar", () => {
  it("stays out of the way when there is nothing pending and nothing selected", () => {
    const { container } = render(
      <EditingStatusBar descriptions={[]} selection={null} onReview={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("counts pending changes, singular and plural", () => {
    const { rerender } = render(
      <EditingStatusBar descriptions={[describeChange("One")]} selection={null} onReview={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.getByText(/1 pending change/)).toBeDefined();

    rerender(
      <EditingStatusBar descriptions={[describeChange("One"), describeChange("Two")]} selection={null} onReview={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.getByText(/2 pending changes/)).toBeDefined();
  });

  it("reveals the pending changes on demand and hides them again", () => {
    render(
      <EditingStatusBar descriptions={[describeChange("Week ending 2026-08-29")]} selection={null} onReview={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(screen.queryByText("Week ending 2026-08-29")).toBeNull();

    const toggle = screen.getByText(/1 pending change/);
    fireEvent.click(toggle);
    expect(screen.getByText("Week ending 2026-08-29")).toBeDefined();

    fireEvent.click(toggle);
    expect(screen.queryByText("Week ending 2026-08-29")).toBeNull();
  });
});

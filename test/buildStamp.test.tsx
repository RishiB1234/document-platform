import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuildStamp } from "../src/build/BuildStamp";

describe("BuildStamp", () => {
  it("shows the commit and a machine-readable build time", () => {
    const markup = renderToStaticMarkup(<BuildStamp commit="1b946f4" builtAt="2026-08-30T18:44:00.000Z" />);
    expect(markup).toContain("<code>1b946f4</code>");
    expect(markup).toContain('dateTime="2026-08-30T18:44:00.000Z"');
  });

  it("keeps the dirty-tree marker visible", () => {
    const markup = renderToStaticMarkup(<BuildStamp commit="1b946f4+" builtAt="2026-08-30T18:44:00.000Z" />);
    expect(markup).toContain("1b946f4+");
  });

  it("renders an unknown commit without inventing a build time", () => {
    const markup = renderToStaticMarkup(<BuildStamp commit="unknown" builtAt="" />);
    expect(markup).toContain("unknown");
    expect(markup).not.toContain("<time");
    expect(markup).not.toContain("Invalid Date");
  });

  it("escapes its inputs like any other untrusted string", () => {
    const markup = renderToStaticMarkup(<BuildStamp commit='<script>alert(1)</script>' builtAt="" />);
    expect(markup).not.toContain("<script>alert");
    expect(markup).toContain("&lt;script&gt;alert");
  });
});

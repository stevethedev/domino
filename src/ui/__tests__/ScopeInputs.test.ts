import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import type { Scope } from "../../data/MultiSiteLoader";
import { editorKeyAction, editorShift, refocusAfterLoad, ScopeInputs } from "../ScopeInputs";

const jira = (id: string, baseJql?: string): SiteConfig => ({
  id,
  label: id,
  baseUrl: "https://acme.atlassian.net",
  auth: { type: "apiToken", email: "bot@example.com", secretRef: "DOMINO_TOKEN" },
  color: "#123456",
  enabled: true,
  ...(baseJql ? { baseJql } : {}),
});
const github = (id: string): SiteConfig => ({
  id,
  kind: "github",
  label: id,
  baseUrl: "https://github.com",
  auth: { type: "githubToken", secretRef: "DOMINO_GITHUB_TOKEN" },
  color: "#123456",
  enabled: true,
});

const render = (sites: SiteConfig[], scope: Scope = { mode: "jql", jql: "statusCategory != Done" }): string =>
  renderToStaticMarkup(createElement(ScopeInputs, { sites, scope, onApply: () => undefined }));
const text = (html: string): string => html.replace(/<[^>]+>/g, "");

describe("ScopeInputs query editor", () => {
  it("at rest shows the query on one line in a button that opens the editor", () => {
    const out = render([jira("Acme")]);
    const summary = /<summary[^>]*class="query-trigger"[^>]*>(.*?)<\/summary>/.exec(out);
    expect(summary).not.toBeNull();
    expect(text(summary?.[1] ?? "")).toContain("statusCategory != Done");
  });

  it("edits in a labelled multi-line box", () => {
    const out = render([jira("Acme")]);
    expect(out).toMatch(/<textarea[^>]*>statusCategory != Done<\/textarea>/);
    expect(out).toContain(">Query<");
  });

  it("shows what each site will run, where everyone can see it, and describes the box with it", () => {
    const out = render([jira("Acme", "project = CORE"), jira("Partner")]);
    const runs = /<div[^>]*id="([^"]+)"[^>]*class="query-runs"[^>]*>(.*?)<\/div>/.exec(out);
    expect(text(runs?.[2] ?? "")).toContain("Acme: (project = CORE) AND (statusCategory != Done)");
    expect(text(runs?.[2] ?? "")).toContain("Partner: statusCategory != Done");
    expect(runs).not.toBeNull();
    expect(out).toContain(`aria-describedby="${runs?.[1] ?? "missing"}"`);
  });

  it("lists the presets as buttons in the editor instead of a separate select", () => {
    const out = render([jira("Acme")]);
    expect(out).not.toContain('aria-label="Query presets"');
    const labelId = /<span class="field-label" id="([^"]+)">Presets<\/span>/.exec(out)?.[1] ?? "missing";
    expect(out).toContain(`<ul class="query-presets" aria-labelledby="${labelId}">`);
    expect(out).toContain(">Open with blocking links (30 days)</button>");
  });

  it("has Load and Cancel in the editor", () => {
    const editor = /<div class="query-editor"[^>]*>(.*)<\/div><\/details>/.exec(render([jira("Acme")]))?.[1] ?? "";
    expect(editor).toMatch(/<button type="submit"[^>]*>Load<\/button>/);
    expect(editor).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
  });

  it("with Jira and GitHub sites, edits both searches, and shows both in the button", () => {
    const out = render([jira("Acme"), github("Hub")], { mode: "jql", jql: "project = CORE", github: "is:open" });
    expect(out.match(/<textarea/g)).toHaveLength(2);
    expect(out).toContain(">GitHub search<");
    const summary = /<summary[^>]*>(.*?)<\/summary>/.exec(out)?.[1] ?? "";
    expect(text(summary)).toContain("project = CORE");
    expect(text(summary)).toContain("is:open");
  });

  it("keeps epic and seed modes as they were: a key field, no editor", () => {
    const out = render([jira("Acme")], { mode: "epic", siteId: "Acme", key: "CORE-1" });
    expect(out).not.toContain("query-trigger");
    expect(out).toContain('value="CORE-1"');
  });
});

describe("editorKeyAction", () => {
  const key = (k: string, mods: Partial<{ shiftKey: boolean; isComposing: boolean }> = {}): ReturnType<typeof editorKeyAction> =>
    editorKeyAction({ key: k, shiftKey: false, isComposing: false, ...mods });

  it("Enter loads, Shift+Enter is a new line, Esc cancels", () => {
    expect(key("Enter")).toBe("load");
    expect(key("Enter", { shiftKey: true })).toBeNull();
    expect(key("Escape")).toBe("cancel");
    expect(key("a")).toBeNull();
  });

  it("leaves Enter and Esc to the input method while it composes text (Esc closes its candidates)", () => {
    expect(key("Enter", { isComposing: true })).toBeNull();
    expect(key("Escape", { isComposing: true })).toBeNull();
  });
});

describe("editorShift", () => {
  it("leaves an editor that opens inside the top bar where it is", () => {
    expect(editorShift({ editorLeft: 161, minLeft: 14 })).toBe(0);
  });

  it("moves an editor that opens past the top bar's left edge (the bar wrapped) back inside it", () => {
    expect(editorShift({ editorLeft: -111, minLeft: 14 })).toBe(125);
  });
});

describe("refocusAfterLoad", () => {
  it("gives focus back to the editor's trigger when the editor loaded the scope", () => {
    expect(refocusAfterLoad({ inEditor: true, inForm: true })).toBe("trigger");
  });

  it("gives focus to Load when the rest of the form loaded it (Epic / Seed, or Load with the editor closed)", () => {
    expect(refocusAfterLoad({ inEditor: false, inForm: true })).toBe("load");
  });

  it("leaves focus alone when it was outside the form", () => {
    expect(refocusAfterLoad({ inEditor: false, inForm: false })).toBeNull();
  });
});

// Typed view of the shared fixtures. The Rust MockBackend embeds the same JSON files.
import type { DominoConfig } from "../config/types";
import type { RawIssue, RawLinkType, RawRemoteLink } from "./jiraTypes";
import acme from "../../fixtures/mock/acme.json";
import partner from "../../fixtures/mock/partner.json";
import linkTypes from "../../fixtures/mock/linkTypes.json";
import config from "../../fixtures/mock/config.json";

export type MockSite = { issues: RawIssue[]; remoteLinks: Record<string, RawRemoteLink[]> };

export const mockSites: Record<string, MockSite> = {
  acme: acme as unknown as MockSite,
  partner: partner as unknown as MockSite,
};

export const mockLinkTypes: RawLinkType[] = linkTypes.issueLinkTypes;

export const mockConfig: DominoConfig = config as DominoConfig;

import { expect, test } from "bun:test";
import { CAMPAIGN_POLL_MS, nextCampaignPoll } from "../src/campaign-poll.js";

const now = Date.parse("2026-11-22T12:00:00.000Z");
const at = (ms) => new Date(now + ms).toISOString();

test("the history waits for the next send, then reads every 10 s while it runs", () => {
  expect(nextCampaignPoll([], now)).toBeNull();
  expect(
    nextCampaignPoll([{ status: "sent", scheduled_at: at(-60000) }], now),
  ).toBeNull();
  expect(
    nextCampaignPoll(
      [
        { status: "scheduled", scheduled_at: at(3600000) },
        { status: "scheduled", scheduled_at: at(30000) },
      ],
      now,
    ),
  ).toBe(31000);
  // A read a moment before the send time waits again instead of stopping.
  expect(
    nextCampaignPoll([{ status: "scheduled", scheduled_at: at(800) }], now),
  ).toBe(1800);
  expect(
    nextCampaignPoll([{ status: "scheduled", scheduled_at: at(-1) }], now),
  ).toBe(CAMPAIGN_POLL_MS);
  expect(
    nextCampaignPoll([{ status: "sending", scheduled_at: at(-60000) }], now),
  ).toBe(CAMPAIGN_POLL_MS);
});

// A scheduled campaign whose time has come waits only for the worker.
export const campaignPhase = (campaign, now = Date.now()) =>
  campaign?.status === "scheduled" && Date.parse(campaign.scheduled_at) <= now
    ? "due"
    : campaign?.status;

export const CAMPAIGN_POLL_MS = 10000;

// How long the send history waits before reading the campaigns again: every
// 10 s while one is due or sending, otherwise until just after the next
// scheduled send, or not at all (null) when nothing is scheduled.
export function nextCampaignPoll(campaigns, now = Date.now()) {
  if (
    campaigns.some((campaign) =>
      ["due", "sending"].includes(campaignPhase(campaign, now)),
    )
  )
    return CAMPAIGN_POLL_MS;
  const next = campaigns
    .filter((campaign) => campaign.status === "scheduled")
    .map((campaign) => Date.parse(campaign.scheduled_at))
    .reduce((soonest, at) => Math.min(soonest, at), Infinity);
  if (next === Infinity) return null;
  return Math.min(Math.max(next - now, 0) + 1000, 2 ** 31 - 1);
}

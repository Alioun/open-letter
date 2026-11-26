export const SIGNER_DETAIL_LIMIT = 160;

// The line under a name in the public list: function and organisation when
// the signer made them public, otherwise the region.
export function signerRowSubtitle(
  cfg,
  region,
  { kreisverband, signerFunction, organisation },
) {
  const showsDetails =
    cfg.features.publicFirstSignerDetails || cfg.features.publicSignerDetails;
  const details = showsDetails
    ? [signerFunction, organisation].filter(Boolean).join(" · ")
    : "";
  if (details) return { text: details, details: true };
  // On a letter that shows function and organisation, a row without them
  // names the region only if the letter asks for one.
  if (showsDetails && !cfg.features.kreisverbandField)
    return { text: "", details: false };
  if (kreisverband)
    return { text: region.rowPrefix + kreisverband, details: false };
  // No region to print. Where the form offers "only my name", that can mean
  // the region is not public, so the row must not say there is none.
  return {
    text: cfg.features.publicSignerDetails ? "" : region.none,
    details: false,
  };
}

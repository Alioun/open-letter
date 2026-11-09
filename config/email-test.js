export function identifiedEmailTest(test) {
  return Boolean(
    test?.accepted &&
    typeof test.id === "string" &&
    test.id &&
    typeof test.recipient === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(test.recipient) &&
    typeof test.checkedAt === "string" &&
    Number.isInteger(test.profileRevision) &&
    Number.isFinite(new Date(test.checkedAt).getTime()),
  );
}

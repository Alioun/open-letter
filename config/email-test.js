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

// Shared by the server that sends the setup test and the admin that asks the
// team to look for it in their inbox.
export const EMAIL_TEST_SUBJECT = "Testnachricht für den E-Mail-Versand";

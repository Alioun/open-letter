import {
  EMAIL_TEST_SUBJECT,
  identifiedEmailTest,
} from "../config/email-test.js";

export default function EmailTestReceipt({ validation }) {
  if (!validation?.accepted) return null;
  if (!identifiedEmailTest(validation))
    return (
      <p className="email-failure" role="status">
        Bei diesem älteren Test fehlen Testadresse oder Zeitpunkt. Sende eine
        neue Testnachricht, bevor du den Empfang bestätigst und den Versand
        freigibst.
      </p>
    );
  return (
    <div className="email-test-receipt">
      <h4>
        {validation.received
          ? "Bestätigte Testnachricht"
          : "Empfang dieser Testnachricht prüfen"}
      </h4>
      <dl>
        <div>
          <dt>Gesendet an</dt>
          <dd>{validation.recipient}</dd>
        </div>
        <div>
          <dt>Betreff</dt>
          <dd>{EMAIL_TEST_SUBJECT}</dd>
        </div>
        <div>
          <dt>Vom Anbieter angenommen</dt>
          <dd>
            {new Date(validation.checkedAt).toLocaleString("de-DE", {
              hour12: false,
            })}
          </dd>
        </div>
      </dl>
      <p>
        Suche diese Nachricht im angegebenen Postfach und im Spamordner.
        Bestätige den Empfang erst, wenn du sie gefunden hast. Eine andere
        Adresse im Testformular ändert diesen Test nicht.
      </p>
    </div>
  );
}

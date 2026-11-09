import { useEffect, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";

export default function PreviewFailure({ failure, busy, onRetry }) {
  const feedback = useRef(null);
  useEffect(() => {
    feedback.current?.focus({ preventScroll: true });
    feedback.current?.scrollIntoView({ block: "nearest" });
  }, [failure, busy]);
  return (
    <div
      ref={feedback}
      tabIndex={-1}
      role="alert"
      className="email-failure publication-preview-error"
    >
      <p>{failure.message}</p>
      {busy && <p role="status">Vorschau wird erstellt…</p>}
      <Button
        type="button"
        className="admin-button"
        disabled={busy}
        onClick={onRetry}
      >
        Vorschau erneut versuchen
      </Button>
      {failure.detail && (
        <Collapsible.Root>
          <Collapsible.Trigger className="admin-disclosure-trigger">
            Technische Angaben
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <p>{failure.detail}</p>
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </div>
  );
}

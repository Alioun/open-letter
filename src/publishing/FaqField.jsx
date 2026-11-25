import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useRef, useState } from "react";
import RichField from "./RichField.jsx";
import { richTextSummary } from "./rich-summary.js";

export default function FaqField({
  value = { introductionHtml: "", items: [] },
  onChange,
}) {
  const [openId, setOpenId] = useState(null);
  const triggers = useRef(new Map());
  const addButton = useRef(null);
  const update = (fn) => {
    const next = structuredClone(value);
    fn(next);
    onChange(next);
  };
  const move = (index, direction) => {
    const id = value.items[index].id;
    update((d) => {
      const target = index + direction;
      [d.items[target], d.items[index]] = [d.items[index], d.items[target]];
    });
    requestAnimationFrame(() => triggers.current.get(id)?.focus());
  };
  return (
    <div className="publication-faq-field">
      <label>Einleitung</label>
      <RichField
        label="FAQ · Einleitung"
        value={value.introductionHtml}
        onChange={(html) =>
          update((d) => {
            d.introductionHtml = html;
          })
        }
      />
      {value.items.map((item, i) => (
        <Collapsible.Root
          className="publication-faq-item"
          key={item.id}
          open={openId === item.id}
          onOpenChange={(open) => setOpenId(open ? item.id : null)}
        >
          <Collapsible.Trigger
            className="publication-faq-trigger"
            ref={(node) => {
              if (node) triggers.current.set(item.id, node);
              else triggers.current.delete(item.id);
            }}
          >
            <span>
              Frage {i + 1}:{" "}
              {richTextSummary(item.questionHtml) || "Neue Frage"}
            </span>
            <span aria-hidden="true">{openId === item.id ? "−" : "+"}</span>
          </Collapsible.Trigger>
          <Collapsible.Panel className="publication-faq-content">
            <label>Frage {i + 1}</label>
            <div className="publication-faq-question">
              <RichField
                label={`FAQ · Frage ${i + 1}`}
                value={item.questionHtml}
                onChange={(html) =>
                  update((d) => {
                    d.items[i].questionHtml = html;
                  })
                }
              />
            </div>
            <label>Antwort {i + 1}</label>
            <RichField
              label={`FAQ · Antwort ${i + 1}`}
              value={item.answerHtml}
              onChange={(html) =>
                update((d) => {
                  d.items[i].answerHtml = html;
                })
              }
            />
          </Collapsible.Panel>
          <div
            className="publication-faq-actions"
            role="group"
            aria-label={`Frage ${i + 1} anordnen`}
          >
            <Button
              className="admin-button admin-button--small"
              aria-label={`Frage ${i + 1} nach oben verschieben`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              Nach oben
            </Button>
            <Button
              className="admin-button admin-button--small"
              aria-label={`Frage ${i + 1} nach unten verschieben`}
              disabled={i === value.items.length - 1}
              onClick={() => move(i, 1)}
            >
              Nach unten
            </Button>
            <Button
              className="admin-button admin-button--danger-secondary admin-button--small publication-faq-remove"
              aria-label={`Frage ${i + 1} entfernen`}
              onClick={() => {
                const nextId = value.items[i + 1]?.id || value.items[i - 1]?.id;
                update((d) => {
                  d.items.splice(i, 1);
                });
                requestAnimationFrame(() =>
                  (triggers.current.get(nextId) || addButton.current)?.focus(),
                );
              }}
            >
              Frage entfernen
            </Button>
          </div>
        </Collapsible.Root>
      ))}
      <Button
        className="admin-button admin-button--block publication-faq-add"
        ref={addButton}
        onClick={() => {
          const id = `question-${crypto.randomUUID()}`;
          update((d) => {
            d.items.push({
              id,
              questionHtml: "<p>Neue Frage</p>",
              answerHtml: "<p>Antwort</p>",
            });
          });
          setOpenId(id);
          requestAnimationFrame(() => triggers.current.get(id)?.focus());
        }}
      >
        Frage hinzufügen
      </Button>
    </div>
  );
}

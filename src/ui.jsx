import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Select } from "@base-ui/react/select";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Button } from "@base-ui/react/button";
import { Children, useEffect, useRef, useState } from "react";

export function Modal({ children, onClose, labelledBy }) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="base-modal-backdrop" />
        <Dialog.Popup className="base-modal-popup" aria-labelledby={labelledBy}>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Choice({
  value,
  onChange,
  options,
  label,
  id,
  disabled = false,
  className = "",
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      items={options.map(([value, label]) => ({ value, label }))}
    >
      <Select.Trigger
        id={id}
        aria-label={label}
        className={`admin-choice ${className}`}
      >
        <Select.Value />
        <Select.Icon> ▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} className="admin-choice-positioner">
          <Select.Popup className="admin-choice-popup">
            {options.map(([value, label]) => (
              <Select.Item
                key={value}
                value={value}
                className="admin-choice-item admin-select-item"
              >
                <Select.ItemText className="admin-select-text">
                  {label}
                </Select.ItemText>
                <Select.ItemIndicator className="admin-select-indicator">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function SelectControl({
  children,
  value,
  onChange,
  "aria-label": label,
  ...props
}) {
  const options = Children.toArray(children)
    .filter(Boolean)
    .map((option) => [String(option.props.value), option.props.children]);
  return (
    <Choice
      {...props}
      value={String(value ?? "")}
      label={label}
      options={options}
      onChange={(value) => onChange({ target: { value } })}
    />
  );
}

export function FreeTextChoice({
  id,
  value,
  onChange,
  items = [],
  placeholder,
  maxLength,
}) {
  return (
    <Autocomplete.Root items={items} value={value} onValueChange={onChange}>
      <Autocomplete.Input
        type="text"
        id={id}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="admin-choice-positioner"
          sideOffset={4}
        >
          <Autocomplete.Popup className="autocomplete-dropdown base-autocomplete">
            <Autocomplete.List>
              {(item) => (
                <Autocomplete.Item
                  className="autocomplete-option"
                  key={item}
                  value={item}
                >
                  {item}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}

// shadcn Calendar composition, styled with the application's existing CSS.
export function Calendar({ className = "", classNames, components, ...props }) {
  const defaults = getDefaultClassNames();
  const [month, setMonth] = useState(props.selected || new Date());
  const selectedTime = props.selected?.getTime();
  useEffect(() => {
    if (props.selected) setMonth(props.selected);
  }, [selectedTime]);
  return (
    <DayPicker
      showOutsideDays
      captionLayout="label"
      month={month}
      onMonthChange={setMonth}
      className={`calendar ${className}`}
      classNames={{
        ...defaults,
        root: `${defaults.root} calendar-root`,
        months: `${defaults.months} calendar-months`,
        month: `${defaults.month} calendar-month`,
        month_caption: `${defaults.month_caption} calendar-caption`,
        nav: `${defaults.nav} calendar-nav`,
        button_previous: `${defaults.button_previous} calendar-nav-button`,
        button_next: `${defaults.button_next} calendar-nav-button`,
        day: `${defaults.day} calendar-day`,
        selected: `${defaults.selected} calendar-selected`,
        today: `${defaults.today} calendar-today`,
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className }) => (
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
            className={className}
            style={{
              transform:
                orientation === "left"
                  ? "rotate(180deg)"
                  : orientation === "up"
                    ? "rotate(-90deg)"
                    : orientation === "down"
                      ? "rotate(90deg)"
                      : undefined,
            }}
          >
            <path
              d="m9 5 7 7-7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({ day, modifiers, className, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <Button
      ref={ref}
      className={`calendar-day-button ${className || ""}`}
      data-day={day.date.toLocaleDateString()}
      data-selected={modifiers.selected || undefined}
      {...props}
    />
  );
}

// request: { message, title?, confirmLabel?, danger?, returnFocus? }. A danger
// request gets a solid red confirm button; give it a verb label ("Löschen").
export function ConfirmDialog({ request, resolve }) {
  const cancelButton = useRef(null);
  if (!request) return null;
  const {
    message,
    title = "Aktion bestätigen",
    confirmLabel = "Bestätigen",
    danger = false,
    returnFocus,
  } = request;
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) resolve(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="base-modal-backdrop" />
        <AlertDialog.Popup
          className={`admin-dialog${danger ? " admin-dialog--danger" : ""}`}
          initialFocus={cancelButton}
          finalFocus={() => (returnFocus?.isConnected ? returnFocus : true)}
        >
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description
            className="admin-dialog-message"
            tabIndex={0}
          >
            {message}
          </AlertDialog.Description>
          <div className="admin-actions">
            <AlertDialog.Close
              ref={cancelButton}
              className="admin-button"
              onClick={() => resolve(false)}
            >
              Abbrechen
            </AlertDialog.Close>
            <Button
              className={`admin-button ${danger ? "admin-button--danger" : "admin-button--primary"}`}
              onClick={() => resolve(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const NOTICE_ROLES = {
  error: "alert",
  warning: "status",
  success: "status",
  info: "status",
};

// Result and status messages. Errors are announced assertively.
export function Notice({
  tone = "info",
  title,
  action,
  onDismiss,
  className = "",
  children,
  ...props
}) {
  return (
    <div
      role={NOTICE_ROLES[tone]}
      className={`admin-notice admin-notice--${tone} ${className}`.trim()}
      {...props}
    >
      <div className="admin-notice-body">
        {title && <strong className="admin-notice-title">{title}</strong>}
        {children}
      </div>
      {action && <div className="admin-notice-actions">{action}</div>}
      {onDismiss && (
        <Button
          type="button"
          className="admin-button admin-button--quiet admin-button--small admin-notice-dismiss"
          aria-label="Hinweis schließen"
          onClick={onDismiss}
        >
          ×
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, action, compact = false, children }) {
  return (
    <div className={`admin-empty${compact ? " admin-empty--compact" : ""}`}>
      {title && <p className="admin-empty-title">{title}</p>}
      {children && <div className="admin-empty-body">{children}</div>}
      {action && <div className="admin-actions">{action}</div>}
    </div>
  );
}

// Lets long e-mail addresses and domains wrap after "@" and "." instead of
// mid-word.
export function Breakable({ text }) {
  return String(text ?? "")
    .split(/(?<=[@.])/)
    .flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));
}

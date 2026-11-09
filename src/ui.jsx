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
}) {
  return (
    <Autocomplete.Root items={items} value={value} onValueChange={onChange}>
      <Autocomplete.Input
        type="text"
        id={id}
        placeholder={placeholder}
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

export function ConfirmDialog({ request, resolve }) {
  const cancelButton = useRef(null);
  if (!request) return null;
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
          className="modal base-confirm"
          initialFocus={cancelButton}
          finalFocus={() =>
            request.returnFocus?.isConnected ? request.returnFocus : true
          }
        >
          <AlertDialog.Title>Aktion bestätigen</AlertDialog.Title>
          <AlertDialog.Description
            className="base-confirm-message"
            tabIndex={0}
          >
            {request.message}
          </AlertDialog.Description>
          <div className="admin-actions">
            <AlertDialog.Close
              ref={cancelButton}
              onClick={() => resolve(false)}
            >
              Abbrechen
            </AlertDialog.Close>
            <Button onClick={() => resolve(true)}>
              {request.confirmLabel || "Bestätigen"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

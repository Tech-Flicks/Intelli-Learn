import { type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  emoji?: string;
  /** Small counter or marker after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  tabs: readonly TabItem<T>[];
  /** Id of the selected tab. */
  value: T;
  onChange: (id: T) => void;
  /** Names the tab list for screen readers. */
  'aria-label': string;
  /**
   * Prefix for element ids. Give the same value to the matching `TabPanel`s.
   * Use a different one for each tab set on a page. Default "tabs".
   */
  idBase?: string;
  className?: string;
}

export function tabId(idBase: string, id: string): string {
  return `${idBase}-tab-${id}`;
}
export function tabPanelId(idBase: string, id: string): string {
  return `${idBase}-panel-${id}`;
}

/** A tab list with roving focus: arrow keys, Home and End move between tabs and select them. */
export function Tabs<T extends string = string>({ tabs, value, onChange, idBase = 'tabs', className, ...aria }: TabsProps<T>) {
  const select = (tab: TabItem<T> | undefined) => {
    if (!tab || tab.disabled) return;
    onChange(tab.id);
    document.getElementById(tabId(idBase, tab.id))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.id === value);
    let next: TabItem<T> | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    else return;
    event.preventDefault();
    select(next);
  };

  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      className={cx('flex gap-1 overflow-x-auto border-b-2 border-ink-200', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={tabId(idBase, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idBase, tab.id)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => select(tab)}
            className={cx(
              '-mb-0.5 inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-xl border-b-4 px-4 text-base font-bold',
              'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
              selected
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-transparent text-ink-700 hover:bg-ink-50 hover:text-ink-900',
            )}
          >
            {tab.emoji !== undefined && <span aria-hidden="true">{tab.emoji}</span>}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** The tab this panel belongs to. */
  id: string;
  /** The same `idBase` the `Tabs` got. Default "tabs". */
  idBase?: string;
  /** Whether this panel's tab is selected. Hidden panels render nothing. */
  active: boolean;
  children?: ReactNode;
}

export function TabPanel({ id, idBase = 'tabs', active, children, className, ...rest }: TabPanelProps) {
  return (
    <div
      {...rest}
      id={tabPanelId(idBase, id)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, id)}
      hidden={!active}
      tabIndex={0}
      className={cx('pt-4', className)}
    >
      {active ? children : null}
    </div>
  );
}

/**
 * `@/ui`: the shared component kit.
 *
 * Two registers from the same tokens (see `src/index.css`):
 * - parent area: `PageShell`, `Button`, `Field` + inputs, `Tabs`, `Stat` ... calm and dense
 * - child area: `ChildShell`, `BigButton`, `Chip size="lg"`, `StarCount` ... big, round and playful
 */
import './strings';

export { cx } from './cx';
export type { ClassValue } from './cx';

export { A11Y_CLASSES, applyAccessibility, prefersReducedMotion, useReducedMotion } from './accessibility';

export { BigButton, Button, IconButton } from './Button';
export type {
  BigButtonProps,
  BigButtonSize,
  BigButtonTone,
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  IconButtonProps,
  IconButtonSize,
  IconButtonVariant,
} from './Button';

export { Card } from './Card';
export type { CardProps, CardTone } from './Card';

export { ConfirmDialog, Modal } from './Modal';
export type { ConfirmDialogProps, ModalProps } from './Modal';

export { Field, NumberInput, PasswordInput, Select, TextArea, TextInput, useFieldControl } from './Field';
export type {
  ControlScale,
  FieldControlProps,
  FieldProps,
  NumberInputProps,
  PasswordInputProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TextInputProps,
} from './Field';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { Badge, Chip, EmptyState, Stat } from './Chip';
export type { BadgeProps, BadgeTone, ChipProps, EmptyStateProps, StatProps } from './Chip';

export { Meter, ProgressBar, Spinner, StarCount } from './Progress';
export type { MeterProps, ProgressBarProps, SpinnerProps, StarCountProps, Tone } from './Progress';

export { ChildShell, PageShell } from './Shell';
export type { ChildShellProps, ChildShellTone, PageShellProps } from './Shell';

export { TabPanel, Tabs, tabId, tabPanelId } from './Tabs';
export type { TabItem, TabPanelProps, TabsProps } from './Tabs';

export { MAX_TOASTS, Toast, ToastViewport, dismissToast, showToast, useToast } from './Toast';
export type { ToastApi, ToastItem, ToastOptions, ToastProps, ToastTone, ToastViewportProps } from './Toast';

export { StageBadge, StageSteps } from './Stage';
export type { StageBadgeProps, StageStepsProps } from './Stage';

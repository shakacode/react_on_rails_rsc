/*
 * TSX fixture: type-only exports must NOT become client references, while
 * every runtime export must.
 *
 * Runtime exports: Badge, useBadge, BADGE_LIMIT, first, rest, Panel, default.
 * Type-only exports: BadgeProps, BadgeVariant, PanelHandle, RenamedProps.
 */

'use client';

import * as React from 'react';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export type BadgeVariant = 'solid' | 'outline';

type PanelHandle = { focus(): void };
export type { PanelHandle };

interface RenamedProps {
  id: string;
}

export const BADGE_LIMIT: number = 10;

export const [first, ...rest]: string[] = ['a', 'b', 'c'];

export function Badge({ label, variant = 'solid' }: BadgeProps): React.ReactElement {
  return <span data-variant={variant}>{label}</span>;
}

export function useBadge<T extends BadgeProps>(props: T): T {
  return props;
}

class Panel extends React.Component<BadgeProps> {
  override render(): React.ReactElement {
    return <div>{this.props.label}</div>;
  }
}

export { Panel, type RenamedProps };

export default function TypedClientComponent(props: BadgeProps): React.ReactElement {
  return <Badge {...props} />;
}

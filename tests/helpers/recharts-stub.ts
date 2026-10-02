// jsdom has no layout, so recharts' ResponsiveContainer measures 0x0 and draws
// nothing. These stand-ins render each chart part as an element that carries the
// props the app passes, so a test can assert what would be drawn (which months,
// which colours, how a tooltip formats a value) without an SVG.
import { createElement, type ReactNode } from 'react';

type Children = { children?: ReactNode };
type Row = Record<string, unknown>;

export const ResponsiveContainer = ({ children }: Children) => createElement('div', { 'data-chart': 'container' }, children);

export const AreaChart = ({ data, children }: Children & { data: Row[] }) =>
  createElement('div', { 'data-chart': 'area', 'data-periods': data.map((row) => String(row.month ?? row.quarter ?? row.year)).join(',') }, children);

export const Area = (props: { dataKey: string; stroke: string; type: string }) =>
  createElement('i', { 'data-area': props.dataKey, 'data-stroke': props.stroke, 'data-type': props.type });

export const PieChart = ({ children }: Children) => createElement('div', { 'data-chart': 'pie' }, children);
export const Pie = ({ data, children }: Children & { data: Row[] }) =>
  createElement('div', { 'data-pie': data.map((slice) => String(slice.name)).join(',') }, children);
export const Cell = (props: { fill: string }) => createElement('i', { 'data-cell-fill': props.fill });

export const BarChart = ({ children }: Children) => createElement('div', { 'data-chart': 'bar' }, children);
export const Bar = (props: { dataKey: string; fill: string }) => createElement('i', { 'data-bar': props.dataKey, 'data-fill': props.fill });

// Renders the formatter's answer for a value the audit saw ("Sep | Scope 1 : 35.9602").
export const Tooltip = ({ formatter }: { formatter?: (value: number) => ReactNode }) =>
  createElement('output', { 'data-tooltip': 'sample' }, formatter ? formatter(35.9602) : null);

export const XAxis = () => null;
export const YAxis = () => null;
export const Legend = () => null;

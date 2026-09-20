import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { EmptyState } from './ui.jsx';

/** One categorical palette used by every chart in the product. */
export const CHART_COLORS = [
  '#245a9e', '#d9a520', '#14b8a6', '#8b5cf6', '#ef4444',
  '#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#64748b',
];

const AXIS = { fontSize: 11, fill: '#64748b' };
const GRID = { stroke: '#e2e8f0', strokeDasharray: '3 3' };

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { fontWeight: 600, color: '#0f172a', marginBottom: 2 },
};

function ChartFrame({ data, height = 260, children, emptyMessage = 'No data for this period yet.' }) {
  if (!data?.length) {
    return <EmptyState icon="bar-chart" title="Nothing to chart" message={emptyMessage} />;
  }
  return (
    <div className="chart-box" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, xKey, series, height = 260, formatter }) {
  return (
    <ChartFrame data={data} height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.key} id={`grad-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={item.color || CHART_COLORS[index]} stopOpacity={0.26} />
              <stop offset="95%" stopColor={item.color || CHART_COLORS[index]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} />
        <Tooltip {...tooltipStyle} formatter={formatter} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((item, index) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color || CHART_COLORS[index]}
            strokeWidth={2}
            fill={`url(#grad-${item.key})`}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function BarsChart({ data, xKey, series, height = 260, formatter, layout = 'horizontal' }) {
  return (
    <ChartFrame data={data} height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 6, right: 8, left: layout === 'vertical' ? 8 : -18, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={layout === 'vertical'} horizontal={layout === 'horizontal'} />
        {layout === 'vertical' ? (
          <>
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={formatter} cursor={{ fill: 'rgba(36,90,158,0.06)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={item.color || CHART_COLORS[index]}
            radius={layout === 'vertical' ? [0, 5, 5, 0] : [5, 5, 0, 0]}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function LinesChart({ data, xKey, series, height = 260, formatter }) {
  return (
    <ChartFrame data={data} height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} />
        <Tooltip {...tooltipStyle} formatter={formatter} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((item, index) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={item.color || CHART_COLORS[index]}
            strokeWidth={2.2}
            dot={{ r: 2.5 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function DonutChart({ data, nameKey = 'name', valueKey = 'value', height = 240, formatter }) {
  return (
    <ChartFrame data={data} height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={formatter} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
      </PieChart>
    </ChartFrame>
  );
}

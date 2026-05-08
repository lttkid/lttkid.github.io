import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StatsSummary } from '../types'

export default function StatsCharts({ stats }: { stats: StatsSummary }) {
  return (
    <div className="chart-grid">
      <section className="chart-panel">
        <h2>最近 7 天</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={stats.dailyMinutes}>
            <defs>
              <linearGradient id="readGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#2563EB" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <Tooltip />
            <Area type="monotone" dataKey="minutes" stroke="#2563EB" fill="url(#readGradient)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <section className="chart-panel">
        <h2>分类阅读</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats.categoryMinutes}>
            <CartesianGrid stroke="#E2E8F0" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <Tooltip />
            <Bar dataKey="minutes" radius={[6, 6, 0, 0]} fill="#10B981" />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}

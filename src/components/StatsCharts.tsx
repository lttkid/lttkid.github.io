import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StatsSummary } from '../types'

export default function StatsCharts({ stats }: { stats: StatsSummary }) {
  const hasDailyMinutes = stats.dailyMinutes.some((item) => item.minutes > 0)
  const hasCategoryMinutes = stats.categoryMinutes.some((item) => item.minutes > 0)
  const chart = {
    accent: 'var(--accent)',
    grid: 'var(--chart-grid)',
    text: 'var(--chart-text)',
    tooltipBg: 'var(--chart-tooltip-bg)',
    tooltipBorder: 'var(--chart-tooltip-border)',
  }
  const tooltipProps = {
    contentStyle: {
      border: `1px solid ${chart.tooltipBorder}`,
      borderRadius: 8,
      background: chart.tooltipBg,
      boxShadow: 'var(--soft-shadow)',
      color: 'var(--text)',
    },
    labelStyle: { color: 'var(--text)', fontWeight: 800 },
    itemStyle: { color: 'var(--text)' },
  }

  return (
    <div className="chart-grid">
      <section className="chart-panel">
        <div className="chart-heading">
          <h2>最近 7 天</h2>
          <span>分钟</span>
        </div>
        {hasDailyMinutes ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={stats.dailyMinutes}>
              <defs>
                <linearGradient id="readGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={chart.accent} stopOpacity={0.46} />
                  <stop offset="95%" stopColor={chart.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: chart.text, fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} width={36} tick={{ fill: chart.text, fontSize: 12 }} />
              <Tooltip {...tooltipProps} labelFormatter={(label) => `日期：${label}`} formatter={(value) => [`${value} 分钟`, '阅读']} />
              <Area type="monotone" dataKey="minutes" stroke={chart.accent} fill="url(#readGradient)" strokeWidth={2.4} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">
            <strong>还没有最近阅读记录</strong>
            <p>打开资料库开始阅读后，这里会显示每天的阅读时长。</p>
          </div>
        )}
      </section>

      <section className="chart-panel">
        <div className="chart-heading">
          <h2>分类阅读</h2>
          <span>按时长</span>
        </div>
        {hasCategoryMinutes ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.categoryMinutes}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: chart.text, fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} width={36} tick={{ fill: chart.text, fontSize: 12 }} />
              <Tooltip {...tooltipProps} labelFormatter={(label) => `分类：${label}`} formatter={(value) => [`${value} 分钟`, '阅读']} />
              <Bar dataKey="minutes" radius={[6, 6, 0, 0]} fillOpacity={0.92}>
                {stats.categoryMinutes.map((category) => (
                  <Cell key={category.name} fill={category.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">
            <strong>暂无分类阅读分布</strong>
            <p>有阅读会话后，会按文档分类汇总时长。</p>
          </div>
        )}
      </section>
    </div>
  )
}

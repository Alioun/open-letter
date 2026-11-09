import { useState } from "react";
import { Slider } from "@base-ui/react/slider";

export const statisticsDate = (value) =>
  new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
const number = (value) => Number(value || 0).toLocaleString("de-DE");

export default function StatisticsChart({ series }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const peak = series.reduce(
    (best, day, index) =>
      day.pageviews > series[best].pageviews ? index : best,
    0,
  );
  const selected = Math.max(
    0,
    series.findIndex((day) => day.ts === selectedDay),
  );
  const index = selectedDay === null ? peak : selected;
  const day = series[index];
  const maximum = Math.max(
    1,
    ...series.flatMap((row) => [row.pageviews, row.visitors]),
  );
  const x = (i) => 5 + (i * 520) / Math.max(1, series.length - 1);
  const y = (value) => 135 - (value / maximum) * 125;
  const points = (key) =>
    series.map((row, i) => `${x(i)},${y(row[key])}`).join(" ");
  const ticks = [...new Set([0, 7, 14, 21, series.length - 1])].filter(
    (i) => i >= 0 && i < series.length,
  );
  const description = `${statisticsDate(day.ts)} UTC: ${number(day.pageviews)} Seitenaufrufe, ${number(day.visitors)} ungefähre Besucher`;
  return (
    <div className="statistics-day-chart">
      <div className="statistics-chart">
        <div className="statistics-scale" aria-hidden="true">
          <span>{number(maximum)}</span>
          <span>{number(Math.round(maximum / 2))}</span>
          <span>0</span>
        </div>
        <div>
          <svg
            viewBox="0 0 530 140"
            preserveAspectRatio="none"
            role="img"
            aria-label="Tägliche Seitenaufrufe und ungefähre Besucher. Wähle einen Tag mit dem Regler darunter."
            onPointerMove={(event) => {
              if (event.pointerType !== "mouse") return;
              const rect = event.currentTarget.getBoundingClientRect();
              const i = Math.round(
                ((event.clientX - rect.left) / rect.width) *
                  (series.length - 1),
              );
              setSelectedDay(
                series[Math.min(series.length - 1, Math.max(0, i))].ts,
              );
            }}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const i = Math.round(
                ((event.clientX - rect.left) / rect.width) *
                  (series.length - 1),
              );
              setSelectedDay(
                series[Math.min(series.length - 1, Math.max(0, i))].ts,
              );
            }}
          >
            {[0, maximum / 2, maximum].map((value) => (
              <line
                key={value}
                x1="0"
                x2="530"
                y1={y(value)}
                y2={y(value)}
                stroke="#dce3ed"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              points={points("pageviews")}
              fill="none"
              stroke="#244ee8"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={points("visitors")}
              fill="none"
              stroke="#187b68"
              strokeWidth="2"
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={x(index)}
              x2={x(index)}
              y1="0"
              y2="140"
              stroke="#59677e"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={x(index)} cy={y(day.pageviews)} r="4" fill="#244ee8" />
            <circle cx={x(index)} cy={y(day.visitors)} r="4" fill="#187b68" />
          </svg>
          <div className="statistics-dates" aria-hidden="true">
            {ticks.map((i) => (
              <span key={i}>{statisticsDate(series[i].ts)}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="statistics-day-value">{description}</p>
      <Slider.Root
        min={0}
        max={Math.max(1, series.length - 1)}
        step={1}
        value={index}
        disabled={series.length < 2}
        onValueChange={(value) => setSelectedDay(series[value].ts)}
      >
        <Slider.Label>Tag im Diagramm auswählen</Slider.Label>
        <Slider.Control className="statistics-day-control">
          <Slider.Track className="statistics-day-track">
            <Slider.Indicator className="statistics-day-indicator" />
            <Slider.Thumb
              className="statistics-day-thumb"
              aria-valuetext={description}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <p className="admin-muted">
        Wähle einen Tag im Diagramm oder mit dem Regler. Am Regler kannst du
        auch die Pfeiltasten verwenden.
      </p>
    </div>
  );
}

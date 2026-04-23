import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useTheme } from "@/context/ThemeContext";
import styles from "./HeadcountStats.module.css";

type AgeBucket = "<20" | "20-30" | "30-40" | "40-50" | "50+" | "Nezadáno";
type TenureBucket =
  | "<1m" | "1-3m" | "3-6m" | "6-12m"
  | "1-2y" | "2-5y" | "5-10y" | "10+y";

interface HeadcountResponse {
  total: number;
  byJobPosition: { name: string; count: number }[];
  byNationality: { name: string; count: number }[];
  byAge: { bucket: AgeBucket; count: number }[];
  byTenure: { bucket: TenureBucket; count: number }[];
}

const AGE_LABELS: Record<AgeBucket, string> = {
  "<20": "do 20 let",
  "20-30": "20–30 let",
  "30-40": "30–40 let",
  "40-50": "40–50 let",
  "50+": "50 a více let",
  "Nezadáno": "Nezadáno",
};

const TENURE_LABELS: Record<TenureBucket, string> = {
  "<1m": "do 1 měsíce",
  "1-3m": "1–3 měsíce",
  "3-6m": "3–6 měsíců",
  "6-12m": "6–12 měsíců",
  "1-2y": "1–2 roky",
  "2-5y": "2–5 let",
  "5-10y": "5–10 let",
  "10+y": "10 a více let",
};

function usePaletteColors() {
  const { theme } = useTheme();
  const [colors, setColors] = useState<{ bar: string; axis: string; grid: string }>({
    bar: "#3b82f6", axis: "#94a3b8", grid: "#e2e8f0",
  });
  useEffect(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const read = (v: string, fallback: string) =>
      (cs.getPropertyValue(v).trim() || fallback);
    setColors({
      bar: read("--color-primary", "#3b82f6"),
      axis: read("--color-text-muted", "#94a3b8"),
      grid: read("--color-border", "#e2e8f0"),
    });
  }, [theme]);
  return colors;
}

export default function HeadcountStats() {
  const [data, setData] = useState<HeadcountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const palette = usePaletteColors();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<HeadcountResponse>("/stats/headcount");
        if (!cancelled) { setData(res); setLoading(false); }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Neznámá chyba");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>HR přehled</h2>
      {loading && <div className={styles.state}>Načítám statistiky…</div>}
      {error && !loading && (
        <div className={`${styles.state} ${styles.stateError}`}>
          Statistiky se nepodařilo načíst.
        </div>
      )}
      {data && !loading && !error && (
        <div className={styles.grid}>
          <TotalTile total={data.total} />
          <BarTile
            title="Pracovní pozice"
            data={data.byJobPosition.map((r) => ({ label: r.name, value: r.count }))}
            palette={palette}
            orientation="horizontal"
          />
          <BarTile
            title="Národnost"
            data={data.byNationality.map((r) => ({ label: r.name, value: r.count }))}
            palette={palette}
            orientation="horizontal"
          />
          <BarTile
            title="Věk"
            data={data.byAge.map((r) => ({ label: AGE_LABELS[r.bucket], value: r.count }))}
            palette={palette}
            orientation="vertical"
          />
          <BarTile
            title="Délka působení"
            data={data.byTenure.map((r) => ({ label: TENURE_LABELS[r.bucket], value: r.count }))}
            palette={palette}
            orientation="horizontal"
          />
        </div>
      )}
    </section>
  );
}

function TotalTile({ total }: { total: number }) {
  return (
    <div className={`${styles.tile} ${styles.totalTile}`}>
      <h3 className={styles.tileTitle}>Celkem zaměstnanců</h3>
      <span className={styles.totalNumber}>{total}</span>
      <span className={styles.totalLabel}>aktivních</span>
    </div>
  );
}

interface BarTileProps {
  title: string;
  data: { label: string; value: number }[];
  palette: { bar: string; axis: string; grid: string };
  orientation: "horizontal" | "vertical";
}

function BarTile({ title, data, palette, orientation }: BarTileProps) {
  const empty = data.length === 0 || data.every((r) => r.value === 0);
  // Height scales with bar count so every bar gets room for its tick label
  // and value label. 40px per row keeps horizontal charts readable; the
  // vertical (age) chart has fixed buckets so the height is constant.
  const dynamicHeight =
    orientation === "horizontal"
      ? Math.max(240, data.length * 40 + 40)
      : 280;

  return (
    <div className={styles.tile}>
      <h3 className={styles.tileTitle}>{title}</h3>
      <div className={styles.chartArea} style={{ height: dynamicHeight }}>
        {empty ? (
          <div className={styles.state}>Žádná data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {orientation === "horizontal" ? (
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
              >
                <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={palette.axis} fontSize={11} allowDecimals={false} />
                <YAxis
                  dataKey="label"
                  type="category"
                  stroke={palette.axis}
                  fontSize={11}
                  width={150}
                  interval={0}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  cursor={{ fill: palette.grid, fillOpacity: 0.25 }}
                />
                <Bar dataKey="value" name="Počet" fill={palette.bar} radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="value" position="right" fontSize={11} fill={palette.axis} />
                  {data.map((_, i) => (
                    <Cell key={i} fill={palette.bar} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke={palette.axis} fontSize={11} interval={0} tickLine={false} />
                <YAxis stroke={palette.axis} fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  cursor={{ fill: palette.grid, fillOpacity: 0.25 }}
                />
                <Bar dataKey="value" name="Počet" fill={palette.bar} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="value" position="top" fontSize={11} fill={palette.axis} />
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

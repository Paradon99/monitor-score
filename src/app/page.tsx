"use client";

import { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import ruleData from "../../rules/score_rules_v1.json";
import seedConfig from "../../data/seed/monitor_config.seed.json";
import standardIndicators from "../../data/seed/standard_indicators.json";
import toolsFromExcel from "../../data/seed/tools_from_excel.json";
import systemsFromExcel from "../../data/seed/systems_from_excel.json";
import configFromDownload from "../../data/seed/monitor_config_from_download.json";
import { supabase } from "../../lib/supabaseClient";

type MonitorLevel = "red" | "orange" | "yellow" | "gray";
type MonitorCategory = "host" | "process" | "network" | "db" | "trans" | "link" | "data" | "client";

interface Scenario {
  id: string;
  category: MonitorCategory;
  metric: string;
  level: MonitorLevel;
  threshold: string;
}

interface MonitorTool {
  id: string;
  name: string;
  defaultCapabilities: MonitorCategory[];
  scenarios: Scenario[];
}

interface SystemData {
  id: string;
  name: string;
  tier: "A" | "B" | "C";
  updatedAt?: string;
  isSelfBuilt: boolean;
  serverCoverage: "full" | "basic" | "partial" | "low";
  selectedToolIds: string[];
  toolCapabilities: Record<string, MonitorCategory[]>;
  checkedScenarioIds: string[];
  documentedItems: number;
  appCoverage?: "full" | "basic" | "partial" | "low";
  serverTotal?: number;
  serverCovered?: number;
  appTotal?: number;
  appCovered?: number;
  accuracy: "perfect" | "high" | "medium" | "low";
  discoveryRate: "perfect" | "high" | "medium" | "low";
  opsLeadConfigured: "full" | "missing";
  dataMonitorConfigured: "full" | "missing" | "na";
  missingMonitorItems: number;
  lateResponseCount: number;
  overdueCount: number;
  // 自动计算输入
  alertTotal?: number;
  falseAlertTotal?: number;
  faultTotal?: number;
  faultDetectedTotal?: number;
  accuracyRate?: number;
  discoveryRatePct?: number;
  avgDetectionTime?: number;
  maxDetectionTime?: number;
  mismatchedAlertsCount?: number;
  earlyDetectionCount?: number;
}

type ScoreDetail = {
  part1: number;
  part2: number;
  part3: number;
  part4: number;
  total: number;
  missingCaps: MonitorCategory[];
  packageLevel: string;
  accuracyRatePct: number;
  discoveryRatePct: number;
  accuracyScore: number;
  discoveryScore: number;
};

const CATEGORY_LABELS: Record<MonitorCategory, string> = {
  host: "主机性能",
  process: "进程状态",
  network: "网络负载",
  db: "数据库",
  trans: "交易监控",
  link: "全链路",
  data: "数据核对",
  client: "客户端",
};

const MANDATORY_CAPS: MonitorCategory[] = ["host", "process", "network", "db", "trans"];

const normalizeCaps = (caps: string[]): MonitorCategory[] => {
  const map: Record<string, MonitorCategory> = {
    主机: "host",
    "主机性能": "host",
    host: "host",
    进程: "process",
    "进程监控": "process",
    process: "process",
    网络: "network",
    "网络监控": "network",
    network: "network",
    数据库: "db",
    "数据库监控": "db",
    db: "db",
    交易: "trans",
    "交易监控": "trans",
    trans: "trans",
    链路: "link",
    "链路监控": "link",
    link: "link",
    数据: "data",
    "数据监控": "data",
    data: "data",
    客户端: "client",
    "客户端监控": "client",
    client: "client",
  };
  const cleaned = caps
    .map((c) => (c || "").toString().toLowerCase().replace(/\s+/g, ""))
    .map((c) => map[c])
    .filter(Boolean) as MonitorCategory[];
  return Array.from(new Set(cleaned));
};

const DEFAULT_TOOLS: MonitorTool[] = (toolsFromExcel as any[]).length
  ? (toolsFromExcel as any[]).map((t, idx) => ({
      id: t.id || `tool_${idx}`,
      name: t.name || `工具${idx + 1}`,
      defaultCapabilities: Array.isArray(t.defaultCapabilities) ? normalizeCaps(t.defaultCapabilities) : [],
      scenarios: [],
    }))
  : [
      {
        id: "zabbix",
        name: "Zabbix",
        defaultCapabilities: ["host", "process", "network"],
        scenarios: [],
      },
    ];

const mergeStandardIndicators = (tools: MonitorTool[]): MonitorTool[] => {
  const std = standardIndicators as Record<string, any[]>;
  return tools.map((t) => {
    const key = Object.keys(std).find(
      (k) => k.toLowerCase() === t.id.toLowerCase() || k.toLowerCase() === t.name.toLowerCase()
    );
    const defaultCaps = normalizeCaps(t.defaultCapabilities || []);
    const scen =
      key && std[key]
        ? (std[key] || []).map((s, idx) => ({
            id: s.id || `${t.id}_${idx}`,
            category: (s.category as MonitorCategory) || "host",
            metric: s.metric,
            level: (s.level as MonitorLevel) || "gray",
            threshold: s.threshold || "",
          }))
        : t.scenarios || [];
    return { ...t, defaultCapabilities: defaultCaps, scenarios: scen };
  });
};

const mapSeedSystem = (raw: any): SystemData => {
  const fd = raw.formData || {};
  const accuracyScore = fd.accuracyRate ?? 1;
  const discoveryScore = fd.discoveryRate ?? 1;
  const toLevel = (v: number): SystemData["accuracy"] => {
    if (v >= 0.99 || v >= 9) return "perfect";
    if (v >= 0.95 || v >= 7) return "high";
    if (v >= 0.9 || v >= 3) return "medium";
    return "low";
  };
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    name: raw.name ?? "未命名系统",
    tier: (raw.class as SystemData["tier"]) || "A",
    isSelfBuilt: Boolean(fd.isSelfBuilt),
    serverCoverage: (fd.packageCoverage as SystemData["serverCoverage"]) || "full",
    appCoverage: (fd.applicationCoverage as SystemData["appCoverage"]) || "full",
    serverTotal: fd.serverTotal ?? 0,
    serverCovered: fd.serverCovered ?? 0,
    appTotal: fd.appTotal ?? 0,
    appCovered: fd.appCovered ?? 0,
    selectedToolIds: fd.selectedTools || [],
    toolCapabilities: fd.toolCaps || {},
    checkedScenarioIds: fd.checkedScenarios || [],
    documentedItems: fd.documentedItemsCount ?? 0,
    accuracy: toLevel(accuracyScore),
    discoveryRate: toLevel(discoveryScore),
    opsLeadConfigured: fd.opsLeadConfigured ? "full" : "missing",
    dataMonitorConfigured:
      fd.dataMonitorMissingCount === 0 || fd.dataMonitorMissingCount === undefined ? "full" : "missing",
    missingMonitorItems: fd.dataMonitorMissingCount ?? 0,
    lateResponseCount: fd.lateResponseCount ?? 0,
    overdueCount: fd.overdueRectificationCount ?? 0,
    alertTotal: undefined,
    falseAlertTotal: undefined,
    faultTotal: undefined,
    faultDetectedTotal: undefined,
    accuracyRate: typeof fd.accuracyRate === "number" ? fd.accuracyRate / 10 : undefined,
    discoveryRatePct: typeof fd.discoveryRate === "number" ? fd.discoveryRate / 10 : undefined,
    avgDetectionTime: fd.avgDetectionTime ?? 0,
    maxDetectionTime: fd.maxDetectionTime ?? 0,
    mismatchedAlertsCount: fd.mismatchedAlertsCount ?? 0,
    earlyDetectionCount: fd.earlyDetectionCount ?? 0,
  };
};

const mapExcelSystem = (raw: any, idx: number): SystemData => ({
  id: raw.id || `sys_${idx}`,
  name: raw.name || raw.system || `系统${idx + 1}`,
  tier: (raw.class as any) || (raw.tier as any) || "A",
  isSelfBuilt: false,
  serverCoverage: "full",
  appCoverage: "full",
  serverTotal: 0,
  serverCovered: 0,
  appTotal: 0,
  appCovered: 0,
  selectedToolIds: [],
  toolCapabilities: {},
  checkedScenarioIds: [],
  documentedItems: 0,
  accuracy: "high",
  discoveryRate: "high",
  opsLeadConfigured: "missing",
  dataMonitorConfigured: "missing",
  missingMonitorItems: 0,
  lateResponseCount: 0,
  overdueCount: 0,
  alertTotal: 0,
  falseAlertTotal: 0,
  faultTotal: 0,
  faultDetectedTotal: 0,
  avgDetectionTime: 0,
  maxDetectionTime: 0,
  mismatchedAlertsCount: 0,
  earlyDetectionCount: 0,
});

const downloadConfigSystems =
  (configFromDownload as any)?.systems && Array.isArray((configFromDownload as any).systems)
    ? (configFromDownload as any).systems.map(mapSeedSystem)
    : [];

const INITIAL_SYSTEMS: SystemData[] =
  downloadConfigSystems.length > 0
    ? downloadConfigSystems
    : Array.isArray((systemsFromExcel as any))
    ? (systemsFromExcel as any).map(mapExcelSystem)
    : Array.isArray((seedConfig as any).systems)
    ? (seedConfig as any).systems.map(mapSeedSystem)
    : [];

const SYSTEM_STORAGE_KEY = "monitor_systems_v8";
const TOOL_STORAGE_KEY = "monitor_tools_v8";

const ruleById = (id: string) =>
  ((ruleData as any).dimensions as any[])
    .flatMap((d: any) => d.items || [])
    .find((i: any) => i.id === id) as any;

const createDefaultSystem = (): SystemData => ({
  id: "sys_default",
  name: "基金代销系统",
  tier: "A",
  isSelfBuilt: false,
  serverCoverage: "full",
  appCoverage: "full",
  serverTotal: 0,
  serverCovered: 0,
  appTotal: 0,
  appCovered: 0,
  selectedToolIds: ["zabbix", "prometheus"],
  toolCapabilities: { zabbix: ["host", "process"], prometheus: ["trans"] },
  checkedScenarioIds: ["z1", "z2", "p1"],
  documentedItems: 5,
  accuracy: "high",
  discoveryRate: "high",
  opsLeadConfigured: "full",
  dataMonitorConfigured: "full",
  missingMonitorItems: 0,
  lateResponseCount: 0,
  overdueCount: 0,
  alertTotal: 0,
  falseAlertTotal: 0,
  faultTotal: 0,
  faultDetectedTotal: 0,
  accuracyRate: undefined,
  discoveryRatePct: undefined,
  avgDetectionTime: 0,
  maxDetectionTime: 0,
  mismatchedAlertsCount: 0,
  earlyDetectionCount: 0,
});

const sanitizeSystem = (s: any): SystemData => ({
  ...createDefaultSystem(),
  ...s,
  selectedToolIds: Array.isArray(s?.selectedToolIds) ? s.selectedToolIds : [],
  toolCapabilities: typeof s?.toolCapabilities === "object" && s?.toolCapabilities ? s.toolCapabilities : {},
  checkedScenarioIds: Array.isArray(s?.checkedScenarioIds) ? s.checkedScenarioIds : [],
  documentedItems: Number.isFinite(s?.documentedItems) ? s.documentedItems : 0,
  accuracy: s?.accuracy ?? "high",
  discoveryRate: s?.discoveryRate ?? "high",
  opsLeadConfigured: s?.opsLeadConfigured ?? "full",
  dataMonitorConfigured: s?.dataMonitorConfigured ?? "full",
  missingMonitorItems: Number.isFinite(s?.missingMonitorItems) ? s.missingMonitorItems : 0,
  lateResponseCount: Number.isFinite(s?.lateResponseCount) ? s.lateResponseCount : 0,
  overdueCount: Number.isFinite(s?.overdueCount) ? s.overdueCount : 0,
  serverCoverage: s?.serverCoverage ?? "full",
  isSelfBuilt: Boolean(s?.isSelfBuilt),
  appCoverage: s?.appCoverage ?? "full",
  serverTotal: Number.isFinite(s?.serverTotal) ? s.serverTotal : 0,
  serverCovered: Number.isFinite(s?.serverCovered) ? s.serverCovered : 0,
  appTotal: Number.isFinite(s?.appTotal) ? s.appTotal : 0,
  appCovered: Number.isFinite(s?.appCovered) ? s.appCovered : 0,
  alertTotal: Number.isFinite(s?.alertTotal) ? s.alertTotal : 0,
  falseAlertTotal: Number.isFinite(s?.falseAlertTotal) ? s.falseAlertTotal : 0,
  faultTotal: Number.isFinite(s?.faultTotal) ? s.faultTotal : 0,
  faultDetectedTotal: Number.isFinite(s?.faultDetectedTotal) ? s.faultDetectedTotal : 0,
  accuracyRate: typeof s?.accuracyRate === "number" ? s.accuracyRate : undefined,
  discoveryRatePct: typeof s?.discoveryRatePct === "number" ? s.discoveryRatePct : undefined,
  avgDetectionTime: Number.isFinite(s?.avgDetectionTime) ? s.avgDetectionTime : 0,
  maxDetectionTime: Number.isFinite(s?.maxDetectionTime) ? s.maxDetectionTime : 0,
  mismatchedAlertsCount: Number.isFinite(s?.mismatchedAlertsCount) ? s.mismatchedAlertsCount : 0,
  earlyDetectionCount: Number.isFinite(s?.earlyDetectionCount) ? s.earlyDetectionCount : 0,
});

const sanitizeTools = (list: any): MonitorTool[] => {
  if (!Array.isArray(list)) return DEFAULT_TOOLS;
  return list.map((t) => ({
    id: t.id ?? `tool_${Date.now()}`,
    name: t.name ?? "未命名工具",
    defaultCapabilities: Array.isArray(t.defaultCapabilities) ? t.defaultCapabilities : [],
    scenarios: Array.isArray(t.scenarios)
      ? t.scenarios.map((s: any) => ({
          id: s.id ?? `scen_${Date.now()}`,
          category: s.category,
          metric: s.metric,
          level: s.level,
          threshold: s.threshold,
        }))
      : [],
  }));
};

const Badge = ({
  children,
  color = "gray",
}: {
  children: React.ReactNode;
  color?: "blue" | "green" | "red" | "yellow" | "gray";
}) => {
  const colors: Record<string, string> = {
    blue: "bg-blue-100 text-blue-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-yellow-100 text-yellow-800",
    gray: "bg-slate-100 text-slate-800",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

type CardProps = React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode };
const Card = ({ children, className = "", ...rest }: CardProps) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`} {...rest}>
    {children}
  </div>
);

const Accordion = ({
  title,
  score,
  total,
  children,
  defaultOpen = false,
}: {
  title: string;
  score: number;
  total: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const scoreColor = score >= total * 0.9 ? "text-green-600" : score >= total * 0.7 ? "text-blue-600" : "text-red-500";
  return (
    <Card className="overflow-hidden">
      <div
        className="flex cursor-pointer items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 hover:bg-slate-100"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
          <h3 className="font-bold text-slate-700">{title}</h3>
        </div>
        <div className="font-mono font-bold">
          <span className={scoreColor}>{score}</span> <span className="text-sm text-slate-400">/ {total}</span>
        </div>
      </div>
      {isOpen && <div className="animate-in slide-in-from-top-2 duration-200 p-5">{children}</div>}
    </Card>
  );
};

const getProgressColor = (pct: number) => {
  if (pct >= 99) return "bg-green-500";
  if (pct >= 95) return "bg-blue-500";
  if (pct >= 85) return "bg-orange-400";
  return "bg-red-500";
};

const deriveAccuracyRate = (data: SystemData): number => {
  if (typeof data.accuracyRate === "number") return data.accuracyRate;
  if (typeof data.alertTotal === "number") {
    const total = data.alertTotal;
    const falseCount = Math.max(0, data.falseAlertTotal ?? 0);
    if (total <= 0) return 0; // 无告警或输入为0时视为0%
    return Math.max(0, Math.min(1, (total - falseCount) / total));
  }
  const map: Record<SystemData["accuracy"], number> = { perfect: 0.995, high: 0.96, medium: 0.92, low: 0.89 };
  return map[data.accuracy];
};

const deriveDiscoveryRate = (data: SystemData): number => {
  if (typeof data.discoveryRatePct === "number") return data.discoveryRatePct;
  if (typeof data.faultTotal === "number" && data.faultTotal > 0) {
    const detected = Math.max(0, data.faultDetectedTotal ?? 0);
    return Math.max(0, Math.min(1, detected / data.faultTotal));
  }
  if (typeof data.faultTotal === "number" && data.faultTotal === 0) return 1;
  const map: Record<SystemData["discoveryRate"], number> = { perfect: 0.995, high: 0.96, medium: 0.9, low: 0.8 };
  return map[data.discoveryRate];
};

const deriveCoverageLevel = (covered: number, total: number): SystemData["serverCoverage"] => {
  if (!total || total <= 0) return "low";
  const pct = covered / total;
  if (pct >= 0.95) return "full";
  if (pct >= 0.7) return "basic";
  if (pct >= 0.5) return "partial";
  return "low";
};

const calculateScore = (data: SystemData, tools: MonitorTool[]): ScoreDetail => {
  const detail: ScoreDetail = {
    part1: 0,
    part2: 0,
    part3: 0,
    part4: 0,
    total: 0,
    missingCaps: [],
    packageLevel: "full",
    accuracyRatePct: 0,
    discoveryRatePct: 0,
    accuracyScore: 0,
    discoveryScore: 0,
  };

  const integrityRule = ruleById("integrity_package");
  const standardRule = ruleById("standardization");
  const docRule = ruleById("documentation");
  const accuracyRule = ruleById("accuracy");
  const discoveryRule = ruleById("discovery_rate");
  const opsLeadRule = ruleById("ops_leads");
  const dataAlertRule = ruleById("data_alert_recipients");
  const responseRule = ruleById("response");
  const rectRule = ruleById("rectification");

  const covered = new Set<MonitorCategory>();
  data.selectedToolIds.forEach((tid) => {
    (data.toolCapabilities[tid] || []).forEach((c) => covered.add(c));
  });
  const missingCaps = MANDATORY_CAPS.filter((c) => !covered.has(c));
  detail.missingCaps = missingCaps;

  const coveragePct = (MANDATORY_CAPS.length - missingCaps.length) / MANDATORY_CAPS.length;
  let pkgDeduct = 0;
  if (coveragePct === 1) {
    detail.packageLevel = "full";
    pkgDeduct = 0;
  } else if (coveragePct >= 0.7) {
    detail.packageLevel = "basic";
    pkgDeduct = 3;
  } else if (coveragePct >= 0.5) {
    detail.packageLevel = "partial";
    pkgDeduct = 7;
  } else {
    detail.packageLevel = "low";
    pkgDeduct = 10;
  }

  const missingDeduct = 10 * missingCaps.length;

  const serverLevel = deriveCoverageLevel(data.serverCovered ?? 0, data.serverTotal ?? 0);
  const appLevel = deriveCoverageLevel(data.appCovered ?? 0, data.appTotal ?? 0);
  const serverDeduct = { full: 0, basic: 3, partial: 7, low: 10 }[serverLevel || data.serverCoverage];
  const appDeduct = { full: 0, basic: 3, partial: 7, low: 10 }[appLevel || data.appCoverage || "full"];

  const selfBuiltBonus = data.isSelfBuilt ? 5 : 0;

  let score1 = 45;
  score1 -= pkgDeduct;
  score1 -= missingDeduct;
  score1 -= serverDeduct;
  score1 -= appDeduct;
  score1 += selfBuiltBonus ?? 0;

  let score1_2 = 0;
  if (data.selectedToolIds.length > 0) {
    let sumTerms = 0;
    data.selectedToolIds.forEach((tid) => {
      const tool = tools.find((t) => t.id === tid);
      if (!tool) return;
      const enabledCaps = data.toolCapabilities[tid] || [];
      const relevant = tool.scenarios.filter((s) => enabledCaps.includes(s.category));
      if (relevant.length === 0) {
        sumTerms += 10; // 无相关指标则视为满分参与平均
        return;
      }
      const checked = relevant.filter((s) => data.checkedScenarioIds.includes(s.id)).length;
      const pct = relevant.length === 0 ? 0 : checked / relevant.length;
      const dr = (standardRule as any)?.deductionRules || [];
      const deduct =
        dr.find((r: any) => pct >= 1 && r.when?.includes(">= 1"))?.deduct ??
        dr.find((r: any) => pct >= 0.7 && r.when?.includes(">= 0.7"))?.deduct ??
        dr.find((r: any) => pct >= 0.5 && r.when?.includes(">= 0.5"))?.deduct ??
        dr.find((r: any) => pct >= 0.3 && r.when?.includes(">= 0.3"))?.deduct ??
        dr.find((r: any) => r.when?.includes("< 0.3"))?.deduct ??
        10;
      sumTerms += Math.max(0, ((standardRule as any)?.basePoints ?? 10) - deduct);
    });
    score1_2 = sumTerms / data.selectedToolIds.length;
  }

  const docBonusRule = (docRule as any)?.rules?.[0];
  const docBonusPer = docBonusRule?.bonusPerItem ?? 1;
  const docCap = docBonusRule?.cap ?? 5;
  const score1_3 = Math.min(docCap, Math.max(0, data.documentedItems * docBonusPer));

  detail.part1 = Math.min(60, Math.round((score1 + score1_2 + score1_3) * 10) / 10);

  const accRate = deriveAccuracyRate(data);
  detail.accuracyRatePct = accRate * 100;
  const accScore = (() => {
    if (accRate >= 0.95) return 10;
    if (accRate >= 0.85) return 7;
    if (accRate >= 0.7) return 3;
    return 0;
  })();
  detail.accuracyScore = accScore;

  const discRate = deriveDiscoveryRate(data);
  detail.discoveryRatePct = discRate * 100;
  const discScore = (() => {
    if (discRate >= 0.95) return 10;
    if (discRate >= 0.85) return 7;
    if (discRate >= 0.7) return 3;
    return 0;
  })();
  detail.discoveryScore = discScore;

  detail.part2 = accScore + discScore;

  let score3 = 0;
  score3 +=
    (opsLeadRule as any)?.rules?.find((r: any) => r.when?.includes("opsLeadConfigured == true"))?.score ??
    (data.opsLeadConfigured === "full" ? 5 : 0);

  if (data.dataMonitorConfigured === "full") {
    score3 +=
      (dataAlertRule as any)?.rules?.find((r: any) => r.when?.includes("dataMonitorEnabled == true"))?.deductPerItem
        ? Math.max(
            0,
            5 -
              Math.min(
                (dataAlertRule as any)?.rules?.find((r: any) => r.when?.includes("deductPerItem"))?.capDeduct ?? 5,
                ((dataAlertRule as any)?.rules?.find((r: any) => r.when?.includes("deductPerItem"))?.deductPerItem ??
                  1) * data.missingMonitorItems
              )
          )
        : 5 - data.missingMonitorItems;
  } else if (data.dataMonitorConfigured === "missing") {
    score3 += Math.max(
      0,
      5 -
        Math.min(
          (dataAlertRule as any)?.rules?.find((r: any) => r.when?.includes("deductPerItem"))?.capDeduct ?? 5,
          data.missingMonitorItems
        )
    );
  } else if (data.dataMonitorConfigured === "na") {
    score3 += (dataAlertRule as any)?.rules?.find((r: any) => r.when?.includes("dataMonitorEnabled == false"))?.score ?? 0;
  }
  detail.part3 = Math.max(0, score3);

  const responseDeductPer =
    (responseRule as any)?.rules?.find((r: any) => r.when?.includes("lateResponseCount"))?.deductPerItem ?? 2.5;
  const responseCap =
    (responseRule as any)?.rules?.find((r: any) => r.when?.includes("lateResponseCount"))?.capDeduct ?? 5;
  const rectDeductPer =
    (rectRule as any)?.rules?.find((r: any) => r.when?.includes("overdueRectificationCount"))?.deductPerItem ?? 1;
  const rectCap =
    (rectRule as any)?.rules?.find((r: any) => r.when?.includes("overdueRectificationCount"))?.capDeduct ?? 5;

  detail.part4 =
    Math.max(0, 5 - Math.min(responseCap, data.lateResponseCount * responseDeductPer)) +
    Math.max(0, 5 - Math.min(rectCap, data.overdueCount * rectDeductPer));

  detail.total = Math.round((detail.part1 + detail.part2 + detail.part3 + detail.part4) * 10) / 10;
  return detail;
};

export default function Home() {
  const initialSystems = INITIAL_SYSTEMS.length > 0 ? INITIAL_SYSTEMS : [createDefaultSystem()];
  const [systems, setSystems] = useState<SystemData[]>(initialSystems.length ? initialSystems : [createDefaultSystem()]);
  const [activeSystemId, setActiveSystemId] = useState<string>(initialSystems[0]?.id || "sys_default");
  const [tools, setTools] = useState<MonitorTool[]>(mergeStandardIndicators(DEFAULT_TOOLS));
  const [view, setView] = useState<"dashboard" | "scoring" | "config">("scoring");
  const [saveHint, setSaveHint] = useState<string>("");
  const [loadingRemote, setLoadingRemote] = useState<boolean>(false);
  const [useLocalCache, setUseLocalCache] = useState<boolean>(true);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [newScenario, setNewScenario] = useState<{ metric: string; threshold: string; category: MonitorCategory; level: MonitorLevel }>({
    metric: "",
    threshold: "",
    category: "host",
    level: "gray",
  });
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const [rightPanelMaxHeight, setRightPanelMaxHeight] = useState<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string>("");

  useEffect(() => {
    if (!useLocalCache) return;
    try {
      const savedSys = localStorage.getItem(SYSTEM_STORAGE_KEY);
      if (savedSys) {
        const parsed = JSON.parse(savedSys);
        const sanitized = Array.isArray(parsed) ? parsed.map(sanitizeSystem) : initialSystems;
        if (sanitized.length > 0) {
          setSystems(sanitized);
          setActiveSystemId(sanitized[0].id);
        }
      }
      const savedTools = localStorage.getItem(TOOL_STORAGE_KEY);
      if (savedTools) setTools(sanitizeTools(JSON.parse(savedTools)));
    } catch (e) {
      console.warn("本地缓存读取失败，使用默认数据", e);
    }
  }, [useLocalCache]);

  useEffect(() => {
    if (!useLocalCache) return;
    localStorage.setItem(SYSTEM_STORAGE_KEY, JSON.stringify(systems));
    setSaveHint("已自动保存评分数据");
    const timer = setTimeout(() => setSaveHint(""), 1200);
    return () => clearTimeout(timer);
  }, [systems, useLocalCache]);

  useEffect(() => {
    if (!useLocalCache) return;
    localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(tools));
    setSaveHint("已自动保存工具配置");
    const timer = setTimeout(() => setSaveHint(""), 1200);
    return () => clearTimeout(timer);
  }, [tools, useLocalCache]);

  const fetchRemote = useCallback(async () => {
    if (!supabase) return;
    setLoadingRemote(true);
    try {
      const { data: toolsData, error: toolsErr } = await supabase
        .from("tools")
        .select("id,name,default_caps,tool_scenarios(id,category,metric,threshold,level,updated_at),updated_at");
      const { data: systemsData, error: sysErr } = await supabase
        .from("systems")
        .select("id,name,class,updated_at,system_tools(tool_id,caps_selected),system_scenarios(scenario_id)");
      if (toolsErr || sysErr) {
        console.warn("Supabase fetch failed", toolsErr || sysErr);
        return;
      }
      if (toolsData) {
        const mappedTools: MonitorTool[] = toolsData.map((t: any) => ({
          id: t.id,
          name: t.name,
          defaultCapabilities: normalizeCaps(t.default_caps || []),
          scenarios: (t.tool_scenarios || []).map((s: any) => ({
            id: s.id,
            category: s.category as MonitorCategory,
            metric: s.metric,
            threshold: s.threshold,
            level: (s.level as MonitorLevel) || "gray",
          })),
        }));
        setTools(mappedTools);
      }
      if (systemsData && systemsData.length) {
        const mappedSystems: SystemData[] = systemsData.map((s: any) => {
          const selectedToolIds = (s.system_tools || []).map((st: any) => st.tool_id);
          const toolCapabilities: Record<string, MonitorCategory[]> = {};
          (s.system_tools || []).forEach((st: any) => {
            toolCapabilities[st.tool_id] = normalizeCaps(st.caps_selected || []);
          });
          const checkedScenarioIds = (s.system_scenarios || []).map((sc: any) => sc.scenario_id);
          return {
            ...createDefaultSystem(),
            id: s.id,
            name: s.name,
            tier: s.class || "A",
            updatedAt: s.updated_at || undefined,
            selectedToolIds,
            toolCapabilities,
            checkedScenarioIds,
          };
        });
        setSystems(mappedSystems);
        setActiveSystemId((prev) => mappedSystems.find((m) => m.id === prev)?.id || mappedSystems[0].id);
      }
    } catch (e) {
      console.warn("Supabase fetch error", e);
    } finally {
      setLoadingRemote(false);
    }
  }, []);

  useEffect(() => {
    fetchRemote();
  }, [fetchRemote]);

  useEffect(() => {
    if (!activeToolId && tools.length) setActiveToolId(tools[0].id);
  }, [tools, activeToolId]);

  const refreshPending = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!supabase) return;
    const tables = ["systems", "system_tools", "system_scenarios", "tools", "tool_scenarios"];
    const channel = supabase.channel("monitor-sync");
    tables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (refreshPending.current) return;
        refreshPending.current = setTimeout(() => {
          fetchRemote();
          refreshPending.current = null;
        }, 300);
      });
    });
    channel.subscribe();
    return () => {
      if (refreshPending.current) clearTimeout(refreshPending.current);
      if (supabase) supabase.removeChannel(channel);
    };
  }, [fetchRemote]);

  const activeSystem = useMemo(
    () => systems.find((s) => s.id === activeSystemId) || systems[0],
    [systems, activeSystemId]
  );
  const scores = useMemo(() => calculateScore(activeSystem, tools), [activeSystem, tools]);
  const activeTool = useMemo(() => tools.find((t) => t.id === activeToolId) || tools[0], [tools, activeToolId]);

  useLayoutEffect(() => {
    const measure = () => {
      if (leftColRef.current) {
        const h = leftColRef.current.getBoundingClientRect().height;
        setRightPanelMaxHeight(h);
      }
    };
    measure();
    const timer = setTimeout(measure, 0);
    return () => clearTimeout(timer);
  }, [activeSystem, scores, tools, systems]);

  const updateSystem = (updates: Partial<SystemData>) => {
    setSystems((prev) => prev.map((s) => (s.id === activeSystemId ? { ...s, ...updates } : s)));
  };

  const toggleTool = (toolId: string) => {
    setSystems((prev) =>
      prev.map((s) => {
        if (s.id !== activeSystemId) return s;
        const current = s.selectedToolIds;
        if (current.includes(toolId)) {
          return {
            ...s,
            selectedToolIds: current.filter((id) => id !== toolId),
            toolCapabilities: { ...s.toolCapabilities, [toolId]: [] },
          };
        }
        const tool = tools.find((t) => t.id === toolId);
        return {
          ...s,
          selectedToolIds: [...current, toolId],
          toolCapabilities: { ...s.toolCapabilities, [toolId]: tool?.defaultCapabilities || [] },
        };
      })
    );
  };

  const toggleToolCapability = (toolId: string, cap: MonitorCategory) => {
    setSystems((prev) =>
      prev.map((s) => {
        if (s.id !== activeSystemId) return s;
        const currentCaps = s.toolCapabilities[toolId] || [];
        const newCaps = currentCaps.includes(cap) ? currentCaps.filter((c) => c !== cap) : [...currentCaps, cap];
        return { ...s, toolCapabilities: { ...s.toolCapabilities, [toolId]: newCaps } };
      })
    );
  };

  const toggleScenario = (id: string) => {
    setSystems((prev) =>
      prev.map((s) => {
        if (s.id !== activeSystemId) return s;
        const current = s.checkedScenarioIds;
        return { ...s, checkedScenarioIds: current.includes(id) ? current.filter((i) => i !== id) : [...current, id] };
      })
    );
  };

  // 配置页：工具与指标编辑
  const addTool = () => {
    const newId = `tool_${Date.now()}`;
    const newTool: MonitorTool = { id: newId, name: `新工具 ${tools.length + 1}`, defaultCapabilities: [], scenarios: [] };
    setTools((prev) => [...prev, newTool]);
    setActiveToolId(newId);
  };

  const deleteTool = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
    if (activeToolId === id) setActiveToolId(null);
  };

  const updateTool = (id: string, patch: Partial<MonitorTool>) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const toggleDefaultCapConfig = (id: string, cap: MonitorCategory) => {
    const tool = tools.find((t) => t.id === id);
    if (!tool) return;
    const caps = tool.defaultCapabilities || [];
    const next = caps.includes(cap) ? caps.filter((c) => c !== cap) : [...caps, cap];
    updateTool(id, { defaultCapabilities: next });
  };

  const addScenario = () => {
    if (!activeTool) return;
    if (!newScenario.metric.trim()) return;
    const scen: Scenario = {
      id: `${activeTool.id}_${Date.now()}`,
      category: newScenario.category,
      metric: newScenario.metric.trim(),
      threshold: newScenario.threshold.trim(),
      level: newScenario.level,
    };
    updateTool(activeTool.id, { scenarios: [...(activeTool.scenarios || []), scen] });
    setNewScenario({ ...newScenario, metric: "", threshold: "" });
  };

  const updateScenarioInline = (sid: string, patch: Partial<Scenario>) => {
    if (!activeTool) return;
    updateTool(
      activeTool.id,
      {
        scenarios: (activeTool.scenarios || []).map((s) => (s.id === sid ? { ...s, ...patch } : s)),
      }
    );
  };

  const deleteScenarioInline = (sid: string) => {
    if (!activeTool) return;
    updateTool(activeTool.id, { scenarios: (activeTool.scenarios || []).filter((s) => s.id !== sid) });
  };

  const addNewSystem = () => {
    const newId = `sys_${Date.now()}`;
    setSystems((prev) => [...prev, { ...(INITIAL_SYSTEMS[0] || createDefaultSystem()), id: newId, name: `新系统 ${newId.slice(-4)}` }]);
    setActiveSystemId(newId);
  };

  const deleteSystem = (id: string) => {
    setSystems((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const def = createDefaultSystem();
        setActiveSystemId(def.id);
        return [def];
      }
      const nextActive = filtered.find((s) => s.id !== id)?.id || filtered[0].id;
      setActiveSystemId(nextActive);
      return filtered;
    });
  };

  const handleSaveClick = () => {
    setConflictMsg("");
    const payload = { system: activeSystem, tools, checkedScenarioIds: activeSystem.checkedScenarioIds, expectedUpdatedAt: activeSystem.updatedAt };
    fetch("/api/save-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (res.status === 409) {
          const msg = (await res.json().catch(() => ({})))?.error || "保存冲突：数据已被他人更新，请刷新后再试。";
          setConflictMsg(msg);
          return;
        }
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({})))?.error || "保存失败";
          setConflictMsg(msg);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.updatedAt) {
          updateSystem({ updatedAt: data.updatedAt });
        }
        setSaveHint("已提交并保存");
        setTimeout(() => setSaveHint(""), 1200);
      })
      .catch((e) => {
        console.warn("save-config error", e);
        setConflictMsg("保存失败，请检查网络或权限");
      });

    fetch("/api/save-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemId: activeSystem.id, scores, ruleVersion: (ruleData as any).version, details: scores }),
    }).catch((e) => console.warn("save-score error", e));
  };

  const handleExport = () => {
    const payload = { systems, tools, ruleVersion: (ruleData as any).version || "unknown" };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "monitor_config_export.json";
    a.click();
    URL.revokeObjectURL(url);
    setSaveHint("已导出配置");
    setTimeout(() => setSaveHint(""), 1200);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.systems && Array.isArray(data.systems)) {
          setSystems(data.systems.map(sanitizeSystem));
          setActiveSystemId(data.systems[0]?.id || activeSystemId);
        }
        if (data.tools && Array.isArray(data.tools)) {
          setTools(mergeStandardIndicators(data.tools as any));
        }
        setSaveHint("已导入配置");
      } catch (err) {
        setSaveHint("导入失败，文件格式错误");
      } finally {
        setTimeout(() => setSaveHint(""), 1500);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {saveHint && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-slate-900/20">
            {saveHint}
          </div>
        </div>
      )}
      {conflictMsg && (
        <div className="fixed inset-x-0 top-16 z-40 flex justify-center px-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-sm">
            {conflictMsg} <button className="ml-2 text-blue-600 underline" onClick={() => fetchRemote()}>刷新数据</button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">M</div>
            <div className="hidden text-lg font-bold md:block">监控评分协作台</div>
            <div className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">规则版本 {(ruleData as any).version || "v1"}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {["scoring", "config", "dashboard"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setView(tab as any)}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    view === tab ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  {tab === "scoring" ? "评分" : tab === "config" ? "配置" : "报表"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={useLocalCache}
                onChange={(e) => setUseLocalCache(e.target.checked)}
              />
              浏览器缓存模式
            </label>
            <button
              onClick={handleSaveClick}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              ☁️ 提交保存
            </button>
            <button
              onClick={handleExport}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              导出配置
            </button>
            <button
              onClick={handleImportClick}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              导入配置
            </button>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {view === "config" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800">工具与指标配置</h2>
                <p className="text-sm text-slate-500">维护工具基础信息、默认覆盖能力与标准指标。</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {loadingRemote ? <span className="text-blue-600">远端数据载入中...</span> : <span>来源：Supabase / 本地缓存</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-4 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-700">监控工具库 ({tools.length})</h3>
                  <button
                    onClick={addTool}
                    className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100"
                  >
                    + 新增工具
                  </button>
                </div>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {tools.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setActiveToolId(t.id)}
                      className={`flex items-center justify-between rounded border p-3 text-sm transition ${
                        activeToolId === t.id ? "border-blue-500 bg-blue-50/50" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-slate-800">{t.name}</div>
                        <div className="text-xs text-slate-500">
                          能力 {t.defaultCapabilities.length} 项 · 指标 {t.scenarios?.length || 0} 条
                        </div>
                      </div>
                      <button
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTool(t.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  {tools.length === 0 && <div className="text-xs text-slate-500">暂无工具，请先添加。</div>}
                </div>
              </Card>

              <Card className="lg:col-span-8 p-5">
                {activeTool ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500">工具名称</label>
                        <input
                          value={activeTool.name}
                          onChange={(e) => updateTool(activeTool.id, { name: e.target.value })}
                          className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div className="text-xs text-slate-500">
                        ID: <span className="font-mono">{activeTool.id}</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-bold text-slate-700">默认覆盖能力</div>
                        <span className="text-xs text-slate-500">影响勾选该工具后自动带出的能力</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        {Object.keys(CATEGORY_LABELS).map((c) => (
                          <label key={c} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={activeTool.defaultCapabilities.includes(c as MonitorCategory)}
                              onChange={() => toggleDefaultCapConfig(activeTool.id, c as MonitorCategory)}
                            />
                            <span className="text-slate-700">{CATEGORY_LABELS[c as MonitorCategory]}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-bold text-slate-700">标准指标 ({activeTool.scenarios?.length || 0})</div>
                        <div className="flex gap-2">
                          <select
                            value={newScenario.category}
                            onChange={(e) => setNewScenario({ ...newScenario, category: e.target.value as MonitorCategory })}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            {Object.keys(CATEGORY_LABELS).map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABELS[c as MonitorCategory]}
                              </option>
                            ))}
                          </select>
                          <select
                            value={newScenario.level}
                            onChange={(e) => setNewScenario({ ...newScenario, level: e.target.value as MonitorLevel })}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            <option value="red">红</option>
                            <option value="orange">橙</option>
                            <option value="yellow">黄</option>
                            <option value="gray">灰</option>
                          </select>
                          <input
                            value={newScenario.metric}
                            onChange={(e) => setNewScenario({ ...newScenario, metric: e.target.value })}
                            placeholder="指标名称"
                            className="w-40 rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                          <input
                            value={newScenario.threshold}
                            onChange={(e) => setNewScenario({ ...newScenario, threshold: e.target.value })}
                            placeholder="阈值/说明"
                            className="w-36 rounded border border-slate-200 px-2 py-1 text-xs"
                          />
                          <button
                            onClick={addScenario}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            + 添加指标
                          </button>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                            <tr>
                              <th className="px-3 py-2">类别</th>
                              <th className="px-3 py-2">指标</th>
                              <th className="px-3 py-2">阈值/说明</th>
                              <th className="px-3 py-2 text-center">级别</th>
                              <th className="px-3 py-2 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(activeTool.scenarios || []).map((s) => (
                              <tr key={s.id} className="border-t border-slate-100">
                                <td className="px-3 py-2">
                                  <select
                                    value={s.category}
                                    onChange={(e) => updateScenarioInline(s.id, { category: e.target.value as MonitorCategory })}
                                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                  >
                                    {Object.keys(CATEGORY_LABELS).map((c) => (
                                      <option key={c} value={c}>
                                        {CATEGORY_LABELS[c as MonitorCategory]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={s.metric}
                                    onChange={(e) => updateScenarioInline(s.id, { metric: e.target.value })}
                                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={s.threshold}
                                    onChange={(e) => updateScenarioInline(s.id, { threshold: e.target.value })}
                                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <select
                                    value={s.level}
                                    onChange={(e) => updateScenarioInline(s.id, { level: e.target.value as MonitorLevel })}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                  >
                                    <option value="red">红</option>
                                    <option value="orange">橙</option>
                                    <option value="yellow">黄</option>
                                    <option value="gray">灰</option>
                                  </select>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => deleteScenarioInline(s.id)}
                                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {(activeTool.scenarios || []).length === 0 && (
                              <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                                  暂无指标，请使用上方表单添加。
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">请选择左侧工具或创建新工具。</div>
                )}
              </Card>
            </div>
          </div>
        )}

        {view === "dashboard" && (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">规则版本</h3>
                  <p className="text-sm text-slate-500">当前使用 {(ruleData as any).version || "v1"} 规则计算得分</p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">v{(ruleData as any).version || "1"}</div>
              </div>
            </Card>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {systems.map((sys) => {
                const s = calculateScore(sys, tools);
                return (
                  <Card
                    key={sys.id}
                    className="cursor-pointer p-6 transition-all hover:shadow-md"
                    onClick={() => {
                      setActiveSystemId(sys.id);
                      setView("scoring");
                    }}
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="text-lg font-bold">{sys.name}</div>
                        <div className="mt-1 text-xs text-slate-500">等级 {sys.tier} 类</div>
                      </div>
                      <div className="text-2xl font-black text-blue-600">{s.total}</div>
                    </div>
                    <div className="space-y-1 text-sm text-slate-500">
                      <div className="flex justify-between">
                        <span>配置</span>
                        <span>{s.part1}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>检测</span>
                        <span>{s.part2}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>告警</span>
                        <span>{s.part3}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>团队</span>
                        <span>{s.part4}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
              <button
                onClick={addNewSystem}
                className="flex min-h-[160px] items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-slate-400 transition hover:border-blue-500 hover:text-blue-500"
              >
                + 新增系统
              </button>
            </div>

            <Card className="p-6">
              <h3 className="text-lg font-bold text-slate-800">短板列表</h3>
              <p className="text-sm text-slate-500">按缺失能力数量排序，快速定位薄弱环节</p>
              <div className="mt-4 space-y-2 text-sm">
                {systems
                  .map((sys) => {
                    const s = calculateScore(sys, tools);
                    return { sys, missing: s.missingCaps.length, caps: s.missingCaps };
                  })
                  .filter((x) => x.missing > 0)
                  .sort((a, b) => b.missing - a.missing)
                  .map((item) => (
                    <div key={item.sys.id} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                      <div>
                        <div className="font-semibold text-slate-800">{item.sys.name}</div>
                        <div className="text-xs text-slate-500">缺失：{item.caps.map((c) => CATEGORY_LABELS[c]).join("、")}</div>
                      </div>
                      <span className="rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-600">-{item.missing * 10}</span>
                    </div>
                  ))}
                {systems.every((sys) => calculateScore(sys, tools).missingCaps.length === 0) && (
                  <div className="text-sm text-slate-500">当前无缺失能力。</div>
                )}
              </div>
            </Card>
          </div>
        )}

        {view === "scoring" && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-bold text-slate-700">评分对象 ({systems.length})</h3>
                <button onClick={addNewSystem} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600">
                  + 新增
                </button>
              </div>
              <div className="max-h-[80vh] space-y-2 overflow-y-auto">
                {systems.map((sys) => (
                  <div
                    key={sys.id}
                    onClick={() => setActiveSystemId(sys.id)}
                    className={`cursor-pointer rounded border p-3 transition-all ${
                      activeSystemId === sys.id
                        ? "border-blue-500 bg-white shadow-md ring-1 ring-blue-500"
                        : "border-transparent bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="font-bold text-slate-800">{sys.name}</div>
                    <div className="mt-1 flex justify-between text-xs text-slate-500">
                      <span>{sys.tier}类系统</span>
                      <span className="font-mono">{calculateScore(sys, tools).total} 分</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 lg:col-span-9">
              <div className="flex items-start justify-between">
                <div>
                  <input
                    value={activeSystem.name}
                    onChange={(e) => updateSystem({ name: e.target.value })}
                    className="text-2xl font-bold border-b border-transparent bg-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-4 text-sm text-slate-500">
                    <select
                      value={activeSystem.tier}
                      onChange={(e) => updateSystem({ tier: e.target.value as any })}
                      className="rounded border-none bg-slate-50 px-2 py-1"
                    >
                      <option value="A">A类核心系统</option>
                      <option value="B">B类重要系统</option>
                      <option value="C">C类一般系统</option>
                    </select>
                    <span>ID: {activeSystem.id}</span>
                    {activeSystem.updatedAt && <span className="text-slate-400">最后保存 {new Date(activeSystem.updatedAt).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => {
                      if (systems.length <= 1) {
                        alert("至少保留一个系统");
                        return;
                      }
                      const confirmDelete = window.confirm(`确认删除系统「${activeSystem.name}」？该操作不可撤销。`);
                      if (confirmDelete) deleteSystem(activeSystem.id);
                    }}
                    className="rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    删除系统
                  </button>
                  <div className="text-right">
                    <div className="text-5xl font-black text-blue-600">{scores.total}</div>
                    <div className="text-xs text-slate-400">总分</div>
                  </div>
                </div>
              </div>

              <Accordion title="1. 配置完整性与标准化" score={scores.part1} total={60} defaultOpen>
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
                  <div className="space-y-4" ref={leftColRef}>
                    <h4 className="mb-3 text-sm font-bold text-slate-500">1.1 监控工具接入</h4>
                    <div className="mb-4 space-y-2">
                      {tools.map((t) => {
                        const selected = activeSystem.selectedToolIds.includes(t.id);
                        return (
                          <div
                            key={t.id}
                            className={`flex flex-col rounded border p-2 ${selected ? "border-blue-200 bg-blue-50" : "border-slate-100"}`}
                          >
                            <div className="flex items-center justify-between">
                              <label className="flex cursor-pointer items-center gap-2">
                                <input type="checkbox" checked={selected} onChange={() => toggleTool(t.id)} />
                                <span className="text-sm font-medium">{t.name}</span>
                              </label>
                            </div>
                            {selected && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {t.defaultCapabilities.map((c) => {
                                  const caps = activeSystem.toolCapabilities[t.id] || [];
                                  const active = caps.includes(c);
                                  return (
                                    <span
                                      key={c}
                                      onClick={() => toggleToolCapability(t.id, c)}
                                      className={`select-none rounded border px-1.5 py-0.5 text-[10px] ${active ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}
                                    >
                                      {CATEGORY_LABELS[c]}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-3 rounded bg-slate-50 p-3 text-sm">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
                            <span>服务器覆盖率</span>
                            <span className="text-blue-600">
                              {Math.min(100, ((activeSystem.serverCovered || 0) / Math.max(1, activeSystem.serverTotal || 0)) * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="space-y-2 text-xs text-slate-600">
                            <label className="flex items-center justify-between">
                              <span>服务器总数</span>
                              <input
                                type="number"
                                min={0}
                                value={activeSystem.serverTotal ?? 0}
                                onChange={(e) => updateSystem({ serverTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-20 rounded border px-2 py-1 text-right"
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span>已接入交易监控</span>
                              <input
                                type="number"
                                min={0}
                                value={activeSystem.serverCovered ?? 0}
                                onChange={(e) => updateSystem({ serverCovered: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-20 rounded border px-2 py-1 text-right"
                              />
                            </label>
                          </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
                            <span>应用覆盖率</span>
                            <span className="text-blue-600">
                              {Math.min(100, ((activeSystem.appCovered || 0) / Math.max(1, activeSystem.appTotal || 0)) * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="space-y-2 text-xs text-slate-600">
                            <label className="flex items-center justify-between">
                              <span>应用总数</span>
                              <input
                                type="number"
                                min={0}
                                value={activeSystem.appTotal ?? 0}
                                onChange={(e) => updateSystem({ appTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-20 rounded border px-2 py-1 text-right"
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span>已接入交易监控</span>
                              <input
                                type="number"
                                min={0}
                                value={activeSystem.appCovered ?? 0}
                                onChange={(e) => updateSystem({ appCovered: Math.max(0, parseInt(e.target.value) || 0) })}
                                className="w-20 rounded border px-2 py-1 text-right"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={activeSystem.isSelfBuilt} onChange={(e) => updateSystem({ isSelfBuilt: e.target.checked })} />
                        存在自建监控 (+5分)
                      </label>
                      <div className="flex items-center justify-between">
                        <span>监控文档化 (0-5分)</span>
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={activeSystem.documentedItems}
                          onChange={(e) => updateSystem({ documentedItems: Number(e.target.value) })}
                          className="w-12 rounded border text-center"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex h-full min-h-0 flex-col">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-500">1.2 指标标准化检查</h4>
                      <div className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-600">共 {activeSystem.selectedToolIds.length} 个工具</div>
                    </div>
                    <div
                      className="flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"
                      style={rightPanelMaxHeight ? { height: rightPanelMaxHeight } : undefined}
                    >
                      <div
                        className="overflow-y-auto"
                        style={
                          rightPanelMaxHeight
                            ? { maxHeight: Math.max(200, rightPanelMaxHeight - 60) }
                            : { maxHeight: 520 }
                        }
                      >
                        {activeSystem.selectedToolIds.length === 0 && (
                          <div className="p-4 text-sm text-slate-400">请先在左侧选择接入的工具</div>
                        )}
                        {activeSystem.selectedToolIds.map((tid) => {
                          const tool = tools.find((t) => t.id === tid);
                          if (!tool) return null;
                          const caps = activeSystem.toolCapabilities[tid] || [];
                          const scens = tool.scenarios.filter((s) => caps.includes(s.category));
                          if (scens.length === 0) return null;
                          return (
                            <div key={tid} className="border-b border-slate-100">
                              <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                                <div className="text-sm font-semibold text-slate-700">{tool.name}</div>
                                <div className="text-xs text-slate-500">已启用能力：{caps.map((c) => CATEGORY_LABELS[c]).join("、")}</div>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-slate-500">
                                  <tr>
                                    <th className="w-10 px-3 py-2 text-left">
                                      <input
                                        type="checkbox"
                                        checked={scens.every((s) => activeSystem.checkedScenarioIds.includes(s.id))}
                                        onChange={(e) => {
                                          const allIds = scens.map((s) => s.id);
                                          if (e.target.checked) {
                                            updateSystem({ checkedScenarioIds: Array.from(new Set([...activeSystem.checkedScenarioIds, ...allIds])) });
                                          } else {
                                            updateSystem({
                                              checkedScenarioIds: activeSystem.checkedScenarioIds.filter((id) => !allIds.includes(id)),
                                            });
                                          }
                                        }}
                                      />
                                    </th>
                                    <th className="px-3 py-2 text-left">类别</th>
                                    <th className="px-3 py-2 text-left">指标</th>
                                    <th className="px-3 py-2 text-left">阈值</th>
                                    <th className="px-3 py-2 text-center">级别</th>
                                    <th className="px-3 py-2 text-center">工具</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {scens.map((s) => (
                                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                                      <td className="px-3 py-2 text-left">
                                        <input
                                          type="checkbox"
                                          checked={activeSystem.checkedScenarioIds.includes(s.id)}
                                          onChange={() => toggleScenario(s.id)}
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-slate-700">{CATEGORY_LABELS[s.category]}</td>
                                      <td className="px-3 py-2 text-slate-800 font-medium">{s.metric}</td>
                                      <td className="px-3 py-2 text-slate-500 text-sm">{s.threshold}</td>
                                      <td className="px-3 py-2 text-center">
                                        <span
                                          className={`inline-block h-3.5 w-3.5 rounded-full ${
                                            s.level === "red"
                                              ? "bg-red-500"
                                              : s.level === "orange"
                                              ? "bg-orange-500"
                                              : s.level === "yellow"
                                              ? "bg-yellow-400"
                                              : "bg-slate-400"
                                          }`}
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-center text-slate-600">{tool.name}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </Accordion>

              <Accordion title="2. 故障检测能力" score={scores.part2} total={20} defaultOpen>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-700">监控准确率 (10分)</h4>
                      <span className="text-xs text-slate-400">告警越准，分数越高</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">告警总数</span>
                          <input
                            type="number"
                            min={0}
                            value={activeSystem.alertTotal ?? 0}
                            onChange={(e) => updateSystem({ alertTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-16 rounded border bg-slate-50 px-1 py-0.5 text-right focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">误告警数</span>
                          <input
                            type="number"
                            min={0}
                            value={activeSystem.falseAlertTotal ?? 0}
                            onChange={(e) => updateSystem({ falseAlertTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-16 rounded border bg-slate-50 px-1 py-0.5 text-right text-red-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div className="mx-2 h-12 w-px bg-slate-100" />
                      <div className="w-24 text-center">
                        <div
                          className={`text-2xl font-black ${
                            scores.accuracyRatePct >= 95 ? "text-green-600" : scores.accuracyRatePct >= 85 ? "text-blue-600" : "text-red-500"
                          }`}
                        >
                          {scores.accuracyRatePct.toFixed(1)}
                          <span className="text-sm font-normal">%</span>
                        </div>
                        <div className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">得分: {scores.accuracyScore}</div>
                      </div>
                    </div>
                    <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-500 ${getProgressColor(scores.accuracyRatePct)}`}
                        style={{ width: `${Math.min(100, scores.accuracyRatePct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-700">监控发现率 (10分)</h4>
                      <span className="text-xs text-slate-400">漏报越少，分数越高</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">生产事件数</span>
                          <input
                            type="number"
                            min={0}
                            value={activeSystem.faultTotal ?? 0}
                            onChange={(e) => updateSystem({ faultTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-16 rounded border bg-slate-50 px-1 py-0.5 text-right focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">监控发现</span>
                          <input
                            type="number"
                            min={0}
                            value={activeSystem.faultDetectedTotal ?? 0}
                            onChange={(e) => updateSystem({ faultDetectedTotal: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="w-16 rounded border bg-slate-50 px-1 py-0.5 text-right text-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div className="mx-2 h-12 w-px bg-slate-100" />
                      <div className="w-24 text-center">
                        <div
                          className={`text-2xl font-black ${
                            scores.discoveryRatePct >= 95 ? "text-green-600" : scores.discoveryRatePct >= 85 ? "text-blue-600" : "text-red-500"
                          }`}
                        >
                          {scores.discoveryRatePct.toFixed(1)}
                          <span className="text-sm font-normal">%</span>
                        </div>
                        <div className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">得分: {scores.discoveryScore}</div>
                      </div>
                    </div>
                    <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-500 ${getProgressColor(scores.discoveryRatePct)}`}
                        style={{ width: `${Math.min(100, scores.discoveryRatePct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Accordion>

              <Accordion title="3. 告警与通知配置" score={scores.part3} total={10} defaultOpen>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">3.1 科管运维负责人 (5分)</div>
                      <span className="text-sm font-bold text-blue-600">5分</span>
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={activeSystem.opsLeadConfigured === "full"}
                        onChange={(e) => updateSystem({ opsLeadConfigured: e.target.checked ? "full" : "missing" })}
                      />
                      <span className="flex-1">已按要求配置负责人</span>
                    </label>
                    <div className="mt-2 text-xs text-slate-500 leading-5">
                      A类要求运维负责人覆盖项目组所有行员、小组 TL 以及对口架构运维组成员；B类系统要求运维负责人覆盖系统主负责人与对口架构运维组成员。
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">3.2 数据级监控告警 (5分)</div>
                      <span className="text-sm font-bold text-blue-600">5分</span>
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={activeSystem.dataMonitorConfigured === "full"}
                        onChange={(e) => updateSystem({ dataMonitorConfigured: e.target.checked ? "full" : "missing" })}
                      />
                      <span className="flex-1">已接入数据级监控</span>
                    </label>
                    <div className="mt-3 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      <span>遗漏监控项数（每项-1）</span>
                      <input
                        type="number"
                        min={0}
                        value={activeSystem.missingMonitorItems}
                        onChange={(e) => updateSystem({ missingMonitorItems: Number(e.target.value) })}
                        className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm"
                      />
                    </div>
                    <div className="mt-2 text-xs text-slate-500 leading-5">
                      告警覆盖系统对应项目组所有行员、小组 TL、对口架构运维组成员以及分管经理。
                    </div>
                  </div>
                </div>
              </Accordion>

              <Accordion title="4. 运维团队能力" score={scores.part4} total={10} defaultOpen>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">4.1 响应能力 (5分)</div>
                      <span className="text-sm font-bold text-blue-600">5分</span>
                    </div>
                    <div className="text-xs text-slate-500">接收告警后的响应敏感度。每次超时扣 2.5 分。</div>
                    <div className="mt-3 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm text-slate-700">响应超时次数</span>
                      <input
                        type="number"
                        min={0}
                        value={activeSystem.lateResponseCount}
                        onChange={(e) => updateSystem({ lateResponseCount: Number(e.target.value) })}
                        className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">4.2 整改情况 (5分)</div>
                      <span className="text-sm font-bold text-blue-600">5分</span>
                    </div>
                    <div className="text-xs text-slate-500">配合整改的完成情况。逾期项每项扣 1 分。</div>
                    <div className="mt-3 flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                      <span className="text-sm text-slate-700">逾期整改项数</span>
                      <input
                        type="number"
                        min={0}
                        value={activeSystem.overdueCount}
                        onChange={(e) => updateSystem({ overdueCount: Number(e.target.value) })}
                        className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm"
                      />
                    </div>
                  </div>
                </div>
              </Accordion>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

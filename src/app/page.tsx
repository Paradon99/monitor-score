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
type Task = { id: string; name: string; description?: string };

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

// 初始不带工具种子，依赖同步从数据库拉取
const DEFAULT_TOOLS: MonitorTool[] = [];

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

// 不再灌入任何默认/种子数据，初始为空，依赖同步从数据库拉取
const INITIAL_SYSTEMS: SystemData[] = [];

const SYSTEM_STORAGE_KEY = "monitor_systems_v8";
const TOOL_STORAGE_KEY = "monitor_tools_v8";
const TASK_STORAGE_KEY = "monitor_tasks_active";
const DEFAULT_TASK_ID = "00000000-0000-0000-0000-000000000000";
const isUUID = (v: string) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

const ruleById = (id: string) =>
  ((ruleData as any).dimensions as any[])
    .flatMap((d: any) => d.items || [])
    .find((i: any) => i.id === id) as any;

const createDefaultSystem = (id: string = "sys_default"): SystemData => ({
  id,
  name: "基金代销系统",
  tier: "A",
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
  selectedToolIds: Array.isArray(s?.selectedToolIds)
    ? s.selectedToolIds.filter((id: string) => typeof id === "string" && /^[0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(id))
    : [],
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

  const selectedWithCaps = (data.selectedToolIds || []).filter(
    (tid) => (data.toolCapabilities[tid] || []).length > 0
  );

  const covered = new Set<MonitorCategory>();
  selectedWithCaps.forEach((tid) => {
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

  // 1.2 标准场景覆盖：以“工具+能力”为单位，只有存在标准指标才参与计分
  let score1_2 = 0;
  const capScores: number[] = [];
  if (selectedWithCaps.length > 0) {
    selectedWithCaps.forEach((tid) => {
      const tool = tools.find((t) => t.id === tid);
      if (!tool) return;
      const enabledCaps = data.toolCapabilities[tid] || [];
      enabledCaps.forEach((cap) => {
        const relevant = tool.scenarios.filter((s) => s.category === cap);
        if (relevant.length === 0) return; // 该能力无标准指标则不计入分母
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
        const base = (standardRule as any)?.basePoints ?? 10;
        capScores.push(Math.max(0, base - deduct));
      });
    });
    if (capScores.length > 0) {
      score1_2 = capScores.reduce((a, b) => a + b, 0) / capScores.length;
    }
  }

  const docBonusRule = (docRule as any)?.rules?.[0];
  const docBonusPer = docBonusRule?.bonusPerItem ?? 1;
  const docCap = docBonusRule?.cap ?? 5;
  const score1_3 = Math.min(docCap, Math.max(0, data.documentedItems * docBonusPer));

  detail.part1 = Math.max(0, Math.min(60, Math.round((score1 + score1_2 + score1_3) * 10) / 10));

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

  detail.part2 = Math.max(0, accScore + discScore);

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

  detail.part4 = Math.max(
    0,
    Math.max(0, 5 - Math.min(responseCap, data.lateResponseCount * responseDeductPer)) +
      Math.max(0, 5 - Math.min(rectCap, data.overdueCount * rectDeductPer))
  );

  detail.total = Math.max(0, Math.round((detail.part1 + detail.part2 + detail.part3 + detail.part4) * 10) / 10);
  return detail;
};

export default function Home() {
  const initialSystems: SystemData[] = INITIAL_SYSTEMS;
  const [systems, setSystems] = useState<SystemData[]>(initialSystems);
  const [activeSystemId, setActiveSystemId] = useState<string>(initialSystems[0]?.id || "");
  const [tools, setTools] = useState<MonitorTool[]>(mergeStandardIndicators(DEFAULT_TOOLS));
  const [tasks, setTasks] = useState<Task[]>([{ id: DEFAULT_TASK_ID, name: "默认任务" }]);
  const [activeTaskId, setActiveTaskId] = useState<string>(DEFAULT_TASK_ID);
  const [view, setView] = useState<"dashboard" | "scoring" | "config">("scoring");
  const [saveHint, setSaveHint] = useState<string>("");
  const [loadingRemote, setLoadingRemote] = useState<boolean>(false);
  const [useLocalCache] = useState<boolean>(true);
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
  const [saving, setSaving] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [hasLocalData, setHasLocalData] = useState<boolean>(false);
  const [creatingTask, setCreatingTask] = useState<boolean>(false);
  const [newTaskName, setNewTaskName] = useState<string>("");
  const [cloneFromTaskId, setCloneFromTaskId] = useState<string | null>(null);
const [dirtyInfoSystems, setDirtyInfoSystems] = useState<Set<string>>(new Set());
const [dirtyCoverageSystems, setDirtyCoverageSystems] = useState<Set<string>>(new Set());
  const [dirtyTools, setDirtyTools] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>("");
  const [hydrated, setHydrated] = useState<boolean>(false);
  const userSelectedTaskRef = useRef<boolean>(false);
  const renameTask = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    const nextName = window.prompt("输入新的任务名称", task?.name || "");
    if (!nextName) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || "重命名失败";
        alert(msg);
        return;
      }
      await fetchRemote();
      setSaveHint("任务已重命名");
      setTimeout(() => setSaveHint(""), 1200);
    } catch (e) {
      console.warn("rename task error", e);
      alert("重命名失败，请稍后重试");
    }
  };

  const deleteTask = async (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (!window.confirm(`确认删除任务「${task.name}」？该操作会删除该任务下的系统与评分。`)) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || "删除任务失败";
        alert(msg);
        return;
      }
      const remaining = tasks.filter((t) => t.id !== id);
      setTasks(remaining.length ? remaining : [{ id: DEFAULT_TASK_ID, name: "默认任务" }]);
      const nextId = remaining[0]?.id || DEFAULT_TASK_ID;
      setActiveTaskId(nextId);
      await fetchRemote();
      setSaveHint("任务已删除");
      setTimeout(() => setSaveHint(""), 1200);
    } catch (e) {
      console.warn("delete task error", e);
      alert("删除任务失败，请稍后重试");
    }
  };

  useEffect(() => {
    try {
      const savedSys = localStorage.getItem(SYSTEM_STORAGE_KEY);
      const savedTools = localStorage.getItem(TOOL_STORAGE_KEY);
      const savedTask = localStorage.getItem(TASK_STORAGE_KEY);
      if (savedTask) setActiveTaskId(isUUID(savedTask) ? savedTask : DEFAULT_TASK_ID);
      if (savedSys) {
        const parsed = JSON.parse(savedSys);
        const sanitized = Array.isArray(parsed) ? parsed.map(sanitizeSystem) : [];
        if (sanitized.length > 0) {
          setSystems(sanitized);
          setActiveSystemId(sanitized[0].id);
          setHasLocalData(true);
        }
      }
      if (savedTools) {
        const parsedTools = sanitizeTools(JSON.parse(savedTools));
        if (parsedTools.length > 0) {
          setTools(parsedTools);
          setHasLocalData(true);
        }
      }
    } catch (e) {
      console.warn("本地缓存读取失败", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SYSTEM_STORAGE_KEY, JSON.stringify(systems));
  }, [systems]);

  useEffect(() => {
    localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(tools));
  }, [tools]);

  useEffect(() => {
    localStorage.setItem(TASK_STORAGE_KEY, activeTaskId);
  }, [activeTaskId]);

  const fetchRemote = useCallback(async (taskIdOverride?: string) => {
    if (!supabase) return;
    setLoadingRemote(true);
    try {
      const taskId = taskIdOverride ?? activeTaskId ?? DEFAULT_TASK_ID;
      const { data: toolsData, error: toolsErr } = await supabase
        .from("tools")
        .select("id,name,default_caps,tool_scenarios(id,category,metric,threshold,level),updated_at")
        .order("updated_at", { ascending: false });
      const { data: systemsData, error: sysErr } = await supabase
        .from("systems")
        .select("id,name,class,updated_at,server_total,server_covered,app_total,app_covered,is_self_built,documented_items");
      const { data: systemToolsData, error: sysToolErr } = await supabase
        .from("system_tools")
        .select("system_id,tool_id,caps_selected,task_id")
        .eq("task_id", taskId || DEFAULT_TASK_ID);
      const { data: systemScenData, error: sysScenErr } = await supabase
        .from("system_scenarios")
        .select("system_id,scenario_id,task_id")
        .eq("task_id", taskId || DEFAULT_TASK_ID);
      const { data: scoreData, error: scoreErr } = await supabase
        .from("scores")
        .select("system_id,details")
        .eq("task_id", taskId || DEFAULT_TASK_ID);
      const systemToolsRows = systemToolsData || [];
      const systemScenRows = systemScenData || [];
      const { data: tasksData } = await supabase
        .from("tasks")
        .select("id,name,description,created_at")
        .order("created_at", { ascending: false });
      if (toolsErr || sysErr || sysToolErr || sysScenErr || scoreErr) {
        console.warn("Supabase fetch failed", toolsErr || sysErr || sysToolErr || sysScenErr || scoreErr);
        return;
      }
      if (tasksData && tasksData.length) {
        setTasks(tasksData);
      }

      // 不再自动回退或扫描其他任务，仅同步当前任务数据

      if (toolsData) {
        const dedup = new Map<string, any>();
        toolsData.forEach((t: any) => {
          if (!dedup.has(t.name)) dedup.set(t.name, t);
        });
        const mappedTools: MonitorTool[] = Array.from(dedup.values()).map((t: any) => ({
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
        setTools(mappedTools.length ? mappedTools : mergeStandardIndicators(DEFAULT_TOOLS));
      }
      if (systemsData && systemsData.length) {
        const toolCapMap = new Map<string, MonitorCategory[]>();
        (toolsData || []).forEach((t: any) => {
          toolCapMap.set(t.id, normalizeCaps(t.default_caps || []));
        });
        const mappedSystems: SystemData[] = systemsData.map((s: any) => {
          const relTools = (systemToolsRows || []).filter((st: any) => st.system_id === s.id);
          const selectedToolIds = relTools.map((st: any) => st.tool_id);
          const toolCapabilities: Record<string, MonitorCategory[]> = {};
          relTools.forEach((st: any) => {
            const capsSel = normalizeCaps(st.caps_selected || []);
            toolCapabilities[st.tool_id] = capsSel;
          });
          const checkedScenarioIds = (systemScenRows || [])
            .filter((sc: any) => sc.system_id === s.id)
            .map((sc: any) => sc.scenario_id);
          const scoreRow = (scoreData || []).find((sc: any) => sc.system_id === s.id);
          const inputs = (scoreRow?.details as any)?.inputs || {};
          return {
            ...createDefaultSystem(),
            id: s.id,
            name: s.name,
            tier: s.class || "A",
            updatedAt: s.updated_at || undefined,
            selectedToolIds,
            toolCapabilities,
            checkedScenarioIds,
            serverTotal: s.server_total ?? 0,
            serverCovered: s.server_covered ?? 0,
            appTotal: s.app_total ?? 0,
            appCovered: s.app_covered ?? 0,
            isSelfBuilt: !!s.is_self_built,
            documentedItems: s.documented_items ?? 0,
            alertTotal: inputs.alertTotal ?? 0,
            falseAlertTotal: inputs.falseAlertTotal ?? 0,
            accuracyRate: inputs.accuracyRate,
            accuracy: inputs.accuracy ?? "high",
            faultTotal: inputs.faultTotal ?? 0,
            faultDetectedTotal: inputs.faultDetectedTotal ?? 0,
            discoveryRatePct: inputs.discoveryRatePct,
            discoveryRate: inputs.discoveryRate,
            dataMonitorConfigured: inputs.dataMonitorConfigured ?? "na",
            missingMonitorItems: inputs.missingMonitorItems ?? 0,
            lateResponseCount: inputs.lateResponseCount ?? 0,
            overdueCount: inputs.overdueCount ?? 0,
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
    setHydrated(true);
  }, []);

  // 如果还未选任务，默认选最新一条；仅在用户未手动切换的情况下兜底
  useEffect(() => {
    if (!activeTaskId && tasks.length) {
      setActiveTaskId(tasks[0].id);
    } else if (activeTaskId && tasks.length && !tasks.find((t) => t.id === activeTaskId) && !userSelectedTaskRef.current) {
      setActiveTaskId(tasks[0].id);
    }
  }, [tasks, activeTaskId]);

  const handleManualSync = async (taskIdOverride?: string) => {
    // 清理本地缓存，避免旧数据闪现
    localStorage.removeItem(SYSTEM_STORAGE_KEY);
    localStorage.removeItem(TOOL_STORAGE_KEY);
    setSyncing(true);
    await fetchRemote(taskIdOverride);
    setSyncing(false);
    setDirtyInfoSystems(new Set());
    setDirtyCoverageSystems(new Set());
    setSaveHint("已从数据库同步");
    setTimeout(() => setSaveHint(""), 1200);
  };

  useEffect(() => {
    handleManualSync();
  }, []);

  useEffect(() => {
    if (!activeToolId && tools.length) setActiveToolId(tools[0].id);
  }, [tools, activeToolId]);

  // 防止提交/同步时误刷新或关闭页面
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saving || syncing) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saving, syncing]);

  const refreshPending = useRef<NodeJS.Timeout | null>(null);
  // 关闭自动实时刷新，改为手动同步

  const activeSystem = useMemo(
    () => systems.find((s) => s.id === activeSystemId) || systems[0] || createDefaultSystem(),
    [systems, activeSystemId]
  );
  const sortedSystems = useMemo(() => {
    const tierWeight: Record<string, number> = { A: 1, B: 2, C: 3 };
    return [...systems].sort((a, b) => {
      const wa = tierWeight[a.tier] ?? 99;
      const wb = tierWeight[b.tier] ?? 99;
      if (wa !== wb) return wa - wb;
      return a.name.localeCompare(b.name, "zh-CN");
    });
  }, [systems]);
  const levelWeight: Record<MonitorLevel, number> = { red: 1, orange: 2, yellow: 3, gray: 4 };
  const sortedToolsForAccess = useMemo(
    () =>
      [...tools].sort(
        (a, b) =>
        (b.scenarios?.length || 0) - (a.scenarios?.length || 0) || a.name.localeCompare(b.name, "zh-CN")
      ),
    [tools]
  );
  const markInfoDirty = (id: string) => {
    setDirtyInfoSystems((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };
  const markCoverageDirty = (id: string) => {
    setDirtyCoverageSystems((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };
  const markAllSystemsDirty = () => {
    const allIds = new Set(systems.map((s) => s.id));
    setDirtyInfoSystems(allIds);
    setDirtyCoverageSystems(allIds);
  };
  const scores = useMemo(() => calculateScore(activeSystem, tools), [activeSystem, tools]);
  const activeTool = useMemo(() => tools.find((t) => t.id === activeToolId) || null, [tools, activeToolId]);

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
    markInfoDirty(activeSystemId);
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
    markCoverageDirty(activeSystemId);
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
    markCoverageDirty(activeSystemId);
  };

  const toggleScenario = (id: string) => {
    setSystems((prev) =>
      prev.map((s) => {
        if (s.id !== activeSystemId) return s;
        const current = s.checkedScenarioIds;
        return { ...s, checkedScenarioIds: current.includes(id) ? current.filter((i) => i !== id) : [...current, id] };
      })
    );
    markCoverageDirty(activeSystemId);
  };

  // 配置页：工具与指标编辑
  const addTool = () => {
    const newId = `tool_${Date.now()}`;
    const newTool: MonitorTool = { id: newId, name: `新工具 ${tools.length + 1}`, defaultCapabilities: [], scenarios: [] };
    setTools((prev) => [...prev, newTool]);
    setActiveToolId(newId);
    setDirtyTools(true);
  };

  const deleteTool = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
    setSystems((prev) =>
      prev.map((s) => ({
        ...s,
        selectedToolIds: s.selectedToolIds.filter((tid) => tid !== id),
        toolCapabilities: Object.fromEntries(Object.entries(s.toolCapabilities || {}).filter(([tid]) => tid !== id)),
      }))
    );
    if (activeToolId === id) setActiveToolId(null);
    setDirtyTools(true);
    // 同步删除到数据库（id 或 name 均可）
    fetch("/api/delete-tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, taskId: activeTaskId }),
    }).catch((err) => console.warn("delete-tool error", err));
  };

  const updateTool = (id: string, patch: Partial<MonitorTool>) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirtyTools(true);
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
    setDirtyTools(true);
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
    setDirtyTools(true);
  };

  const deleteScenarioInline = (sid: string) => {
    if (!activeTool) return;
    updateTool(activeTool.id, { scenarios: (activeTool.scenarios || []).filter((s) => s.id !== sid) });
    setDirtyTools(true);
  };

  const addNewSystem = () => {
    const newId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `sys_${Date.now()}`;
    setSystems((prev) => [...prev, { ...(INITIAL_SYSTEMS[0] || createDefaultSystem()), id: newId, name: `新系统 ${newId.slice(-4)}` }]);
    setActiveSystemId(newId);
    markInfoDirty(newId);
    markCoverageDirty(newId);
  };

  const deleteSystem = (id: string, name?: string) => {
    setSystems((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const def = createDefaultSystem();
        setActiveSystemId(def.id);
        return [def];
      }
      const nextActive = filtered[0].id;
      setActiveSystemId(nextActive);
      return filtered;
    });
    setDirtyInfoSystems((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDirtyCoverageSystems((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    // 同步删除 Supabase
    fetch("/api/delete-system", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, taskId: activeTaskId }),
    }).catch((err) => {
      console.warn("delete-system error", err);
      setConflictMsg("删除失败，请稍后重试");
    });
  };

  const saveSystemsBatch = async (targetIds: string[]) => {
    if (!activeTaskId || targetIds.length === 0) {
      setConflictMsg(targetIds.length === 0 ? "没有改动需要提交" : "请先选择任务");
      return;
    }
    console.log("[debug] save batch entry", {
      taskId: activeTaskId,
      targetIds,
      systemsCount: systems.length,
      dirty: Array.from(new Set([...dirtyInfoSystems, ...dirtyCoverageSystems])),
    });
    setConflictMsg("");
    setSaving(true);
    let updatedSystems = [...systems];
    let updatedTools = [...tools];
    let toolsToSend: MonitorTool[] = dirtyTools ? [...updatedTools] : [];
    let toolIdMap: Record<string, string> = {};
    let scenarioIdMap: Record<string, string> = {};
    const savedIds: string[] = [];
    const systemIdMap: Record<string, string> = {};

    try {
      for (let i = 0; i < targetIds.length; i++) {
        setProgressText(`保存中 ${i + 1}/${targetIds.length}`);
        const sys = updatedSystems.find((s) => s.id === targetIds[i]);
        if (!sys) continue;
        // 调试：提交前打印当前系统和打分
        const calcScore = calculateScore(sys, updatedTools);
        console.log("[debug] save system payload", {
          taskId: activeTaskId,
          sysId: sys.id,
          sysName: sys.name,
          tier: sys.tier,
          selectedToolIds: sys.selectedToolIds,
          toolCapabilities: sys.toolCapabilities,
          checkedScenarioIds: sys.checkedScenarioIds,
          scorePreview: calcScore,
        });
        const payload = {
          system: sys,
          tools: toolsToSend,
          checkedScenarioIds: sys.checkedScenarioIds,
          expectedUpdatedAt: sys.updatedAt,
          taskId: activeTaskId,
        };
        const resCfg = await fetch("/api/save-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (resCfg.status === 409) {
          const msg =
            (await resCfg.json().catch(() => ({})))?.error ||
            `保存冲突：${sys.name} 已被他人更新，请同步后再试。`;
          setConflictMsg(msg);
          setSaving(false);
          setProgressText("");
          return;
        }
        if (!resCfg.ok) {
          const msg = (await resCfg.json().catch(() => ({})))?.error || "保存失败";
          setConflictMsg(msg);
          setSaving(false);
          setProgressText("");
          return;
        }
        const data = await resCfg.json().catch(() => ({}));
        toolIdMap = { ...toolIdMap, ...(data.toolIdMap || {}) };
        scenarioIdMap = { ...scenarioIdMap, ...(data.scenarioIdMap || {}) };
        const newSysId = data.systemId || sys.id;
        if (newSysId !== sys.id) {
          systemIdMap[sys.id] = newSysId;
        }
        const mappedSys = {
          ...sys,
          id: newSysId,
          updatedAt: data.updatedAt || sys.updatedAt,
          selectedToolIds: sys.selectedToolIds.map((tid) => data.toolIdMap?.[tid] || tid),
          toolCapabilities: Object.fromEntries(
            Object.entries(sys.toolCapabilities || {}).map(([tid, caps]) => [data.toolIdMap?.[tid] || tid, caps as any])
          ),
          checkedScenarioIds: sys.checkedScenarioIds.map((sid) => data.scenarioIdMap?.[sid] || sid),
        };
        updatedSystems = updatedSystems.map((s) => (s.id === sys.id ? mappedSys : s));

        const finalScore = calculateScore(mappedSys, updatedTools);
        console.log("[debug] save-score payload", {
          taskId: activeTaskId,
          systemId: newSysId,
          scorePayload: finalScore,
        });
        const scoreInputs = {
          alertTotal: mappedSys.alertTotal,
          falseAlertTotal: mappedSys.falseAlertTotal,
          accuracyRate: mappedSys.accuracyRate,
          accuracy: mappedSys.accuracy,
          faultTotal: mappedSys.faultTotal,
          faultDetectedTotal: mappedSys.faultDetectedTotal,
          discoveryRatePct: mappedSys.discoveryRatePct,
          discoveryRate: mappedSys.discoveryRate,
          dataMonitorConfigured: mappedSys.dataMonitorConfigured,
          missingMonitorItems: mappedSys.missingMonitorItems,
          lateResponseCount: mappedSys.lateResponseCount,
          overdueCount: mappedSys.overdueCount,
          serverTotal: mappedSys.serverTotal,
          serverCovered: mappedSys.serverCovered,
          appTotal: mappedSys.appTotal,
          appCovered: mappedSys.appCovered,
          documentedItems: mappedSys.documentedItems,
          isSelfBuilt: mappedSys.isSelfBuilt,
        };

        const resScore = await fetch("/api/save-score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: activeTaskId,
            systemId: newSysId,
            scores: finalScore,
            ruleVersion: (ruleData as any).version,
            details: { ...finalScore, inputs: scoreInputs },
          }),
        });
        if (!resScore.ok) {
          const msg = (await resScore.json().catch(() => ({})))?.error || "评分保存失败";
          setConflictMsg(msg);
          setSaving(false);
          setProgressText("");
          return;
        }
        savedIds.push(newSysId);
        toolsToSend = []; // 工具配置提交一次即可，避免重复 upsert
      }

      if (Object.keys(toolIdMap).length || Object.keys(scenarioIdMap).length) {
        updatedTools = updatedTools.map((t) => {
          const newId = toolIdMap[t.id] || t.id;
          return {
            ...t,
            id: newId,
            scenarios: (t.scenarios || []).map((s) => ({
              ...s,
              id: scenarioIdMap[s.id] || s.id,
            })),
          };
        });
      }

      setTools(updatedTools);
      setSystems(updatedSystems);
      setDirtyInfoSystems((prev) => {
        const next = new Set(prev);
        savedIds.forEach((id) => next.delete(id));
        Object.entries(systemIdMap).forEach(([oldId, newId]) => {
          if (next.has(oldId)) {
            next.delete(oldId);
            next.add(newId);
          }
        });
        return next;
      });
      setDirtyCoverageSystems((prev) => {
        const next = new Set(prev);
        savedIds.forEach((id) => next.delete(id));
        Object.entries(systemIdMap).forEach(([oldId, newId]) => {
          if (next.has(oldId)) {
            next.delete(oldId);
            next.add(newId);
          }
        });
        return next;
      });
      if (dirtyTools) setDirtyTools(false);
      setActiveSystemId((prev) => systemIdMap[prev] || prev);

      setSaveHint(targetIds.length === systems.length ? "全部系统已保存到数据库" : "当前系统已保存");
      setTimeout(() => setSaveHint(""), 1200);
    } catch (e) {
      console.warn("save-config/score error", e);
      setConflictMsg("保存失败，请检查网络或权限");
    } finally {
      setSaving(false);
      setProgressText("");
    }
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

  if (!hydrated) {
    return <div className="min-h-screen bg-slate-50 text-slate-500 p-6">页面加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {(saveHint || saving || syncing) && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-slate-900/20">
            {saving ? progressText || "保存中，请稍候..." : syncing ? "同步中..." : saveHint}
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
            <div className="hidden text-lg font-bold md:block flex items-center gap-2">
              <span>监控评分协作台</span>
              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                {tasks.find((t) => t.id === activeTaskId)?.name || "未选择任务"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {["scoring", "config", "dashboard"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setView(tab as any)}
                  disabled={saving || syncing}
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    view === tab ? "bg-white text-blue-600 shadow-sm" : "text-slate-600 hover:text-slate-800"
                  } ${saving || syncing ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {tab === "scoring" ? "评分" : tab === "config" ? "配置" : "报表"}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleManualSync()}
              disabled={syncing || saving}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                syncing ? "bg-amber-300 cursor-wait" : "bg-amber-500 hover:bg-amber-600"
              }`}
            >
              {syncing || loadingRemote ? "同步中..." : "⇅ 同步数据"}
            </button>
            <button
              onClick={() => {
                const targetSet = new Set([...dirtyInfoSystems, ...dirtyCoverageSystems]);
                const targetIds =
                  targetSet.size > 0
                    ? Array.from(targetSet)
                    : dirtyTools && systems.length
                    ? [systems[0].id]
                    : [];
                saveSystemsBatch(targetIds);
              }}
              disabled={saving}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
                saving ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {saving
                ? "保存中..."
                : `☁️ 提交改动${
                    dirtyInfoSystems.size + dirtyCoverageSystems.size > 0
                      ? `(${dirtyInfoSystems.size + dirtyCoverageSystems.size})`
                      : dirtyTools
                      ? "(工具/指标)"
                      : ""
                  }`}
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

      {(saving || syncing || creatingTask) && (
        <div className="fixed inset-0 z-40 bg-black/10 backdrop-blur-sm" aria-hidden />
      )}

      {creatingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-slate-800">新建任务</div>
                <div className="text-xs text-slate-500">可选从历史任务复制配置</div>
              </div>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setCreatingTask(false)}>
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">任务名称</label>
                <input
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="例如：2026年一季度"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">从历史任务复制（可选）</label>
                <select
                  value={cloneFromTaskId || ""}
                  onChange={(e) => setCloneFromTaskId(e.target.value || null)}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">不复制，空白任务</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setCreatingTask(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    if (!newTaskName.trim()) {
                      alert("请输入任务名称");
                      return;
                    }
                    setSaving(true);
                    try {
                      const res = await fetch("/api/tasks", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: newTaskName.trim(), cloneFrom: cloneFromTaskId || undefined }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        alert(data?.error || "创建任务失败");
                      } else {
                        await fetchRemote();
                        setActiveTaskId(data.id);
                        setSaveHint("任务创建成功");
                        setTimeout(() => setSaveHint(""), 1200);
                      }
                    } catch (e) {
                      console.warn("create task error", e);
                      alert("创建任务失败，请稍后重试");
                    } finally {
                      setSaving(false);
                      setCreatingTask(false);
                      setNewTaskName("");
                      setCloneFromTaskId(null);
                    }
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className={`mx-auto max-w-7xl px-4 py-8 ${saving ? "pointer-events-none select-none opacity-90" : ""}`}>
        {view === "config" && (
          <div className="space-y-4">
            <Card className="p-4 flex flex-wrap items-center gap-3">
              <div className="text-sm font-bold text-slate-700">任务管理</div>
              <select
                value={activeTaskId}
                onChange={(e) => {
                  const tid = e.target.value;
                  userSelectedTaskRef.current = true;
                  setActiveTaskId(tid);
                  handleManualSync(tid);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setCreatingTask(true)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
              >
                + 新建任务
              </button>
              <button
                onClick={() => renameTask(activeTaskId)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
              >
                重命名
              </button>
              <button
                onClick={() => deleteTask(activeTaskId)}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                删除任务
              </button>
            </Card>
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
            <div className="space-y-2">
              {sortedSystems.map((sys) => (
                <div
                  key={sys.id}
                  className={`group relative overflow-hidden rounded border p-3 transition-all ${
                    activeSystemId === sys.id
                        ? "border-blue-500 bg-white shadow-md ring-1 ring-blue-500"
                        : "border-transparent bg-white hover:border-slate-300"
                    }`}
                  >
                    <button onClick={() => setActiveSystemId(sys.id)} className="block w-full text-left">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-slate-800">{sys.name}</div>
                        {dirtyInfoSystems.has(sys.id) || dirtyCoverageSystems.has(sys.id) ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            已改动
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500">
                        <span>{sys.tier}类系统</span>
                        <span className="font-mono">{calculateScore(sys, tools).total} 分</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        if (sortedSystems.length <= 1) {
                          alert("至少保留一个系统");
                          return;
                        }
                        const confirmDelete = window.confirm(`确认删除系统「${sys.name}」？该操作不可撤销。`);
                        if (confirmDelete) deleteSystem(sys.id, sys.name);
                      }}
                      className="absolute right-2 top-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-red-600 hover:border-red-200"
                    >
                      删除
                    </button>
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
                <div className="text-right">
                  <div className="text-5xl font-black text-blue-600">{scores.total}</div>
                  <div className="text-xs text-slate-400">总分</div>
                </div>
              </div>

              <Accordion title="1. 配置完整性与标准化" score={scores.part1} total={60} defaultOpen>
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start">
                  <div className="space-y-4" ref={leftColRef}>
                    <h4 className="mb-3 text-sm font-bold text-slate-500">1.1 监控工具接入</h4>
                    <div className="mb-4 space-y-2">
                      {sortedToolsForAccess.map((t) => {
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
                        {sortedToolsForAccess
                          .filter((t) => activeSystem.selectedToolIds.includes(t.id))
                          .map((tool) => {
                            const caps = activeSystem.toolCapabilities[tool.id] || [];
                            const scens = (tool.scenarios || [])
                              .filter((s) => caps.includes(s.category))
                              .slice()
                              .sort((a, b) => {
                                const catA = CATEGORY_LABELS[a.category];
                                const catB = CATEGORY_LABELS[b.category];
                                const catCmp = catA.localeCompare(catB, "zh-CN");
                                if (catCmp !== 0) return catCmp;
                                const metricCmp = a.metric.localeCompare(b.metric, "zh-CN");
                                if (metricCmp !== 0) return metricCmp;
                                return levelWeight[a.level] - levelWeight[b.level];
                              });
                            if (scens.length === 0) return null;
                          return (
                            <div key={tool.id} className="border-b border-slate-100">
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
                                      <tr
                                        key={s.id}
                                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleScenario(s.id);
                                        }}
                                      >
                                        <td className="px-3 py-2 text-left">
                                          <input
                                            type="checkbox"
                                            checked={activeSystem.checkedScenarioIds.includes(s.id)}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              toggleScenario(s.id);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
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

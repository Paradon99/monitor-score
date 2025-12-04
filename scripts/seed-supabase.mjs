import { createClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';
const toolsSeed = JSON.parse(await readFile(new URL('../data/seed/tools_from_excel.json', import.meta.url), 'utf-8'));
const systemsSeed = JSON.parse(await readFile(new URL('../data/seed/systems_from_excel.json', import.meta.url), 'utf-8'));
const indicatorsSeed = JSON.parse(await readFile(new URL('../data/seed/standard_indicators.json', import.meta.url), 'utf-8'));
const configSeed = JSON.parse(await readFile(new URL('../data/seed/monitor_config_from_download.json', import.meta.url), 'utf-8'));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('缺少 SUPABASE URL 或 SERVICE ROLE KEY');

const supabase = createClient(url, serviceKey);

// 可选：先清表，避免重复（谨慎执行）
await supabase.from('system_scenarios').delete().neq('id', '');
await supabase.from('system_tools').delete().neq('id', '');
await supabase.from('scores').delete().neq('id', '');
await supabase.from('tool_scenarios').delete().neq('id', '');
await supabase.from('tools').delete().neq('id', '');
await supabase.from('systems').delete().neq('id', '');

// 1) 导入工具
const normalizeCaps = (caps = []) => {
  const map = {
    主机: 'host', 主机性能: 'host', host: 'host',
    进程: 'process', 进程监控: 'process', process: 'process',
    网络: 'network', 网络监控: 'network', network: 'network',
    数据库: 'db', 数据库监控: 'db', db: 'db',
    交易: 'trans', 交易监控: 'trans', trans: 'trans',
    链路: 'link', 链路监控: 'link', link: 'link',
    数据: 'data', 数据监控: 'data', data: 'data',
    客户端: 'client', 客户端监控: 'client', client: 'client',
  };
  return [...new Set(caps.map(c => map[String(c).toLowerCase().replace(/\s+/g, '')]).filter(Boolean))];
};

const toolRows = toolsSeed.map((t, idx) => ({
  name: t.name || `工具${idx + 1}`,
  default_caps: normalizeCaps(t.defaultCapabilities || [])
}));
const { data: toolsInserted, error: toolsErr } = await supabase.from('tools').insert(toolRows).select('id,name');
if (toolsErr) throw toolsErr;
const toolIdByName = Object.fromEntries(toolsInserted.map(t => [t.name.toLowerCase(), t.id]));

// 2) 导入标准指标 -> tool_scenarios
const scenarioRows = [];
for (const [toolName, arr] of Object.entries(indicatorsSeed)) {
  const tool_id = toolIdByName[toolName.toLowerCase()];
  if (!tool_id) continue;
  for (const s of arr) {
    scenarioRows.push({
      tool_id,
      category: s.category || 'host',
      metric: s.metric,
      threshold: s.threshold || '',
      level: s.level || 'gray'
    });
  }
}
if (scenarioRows.length) {
  const { error: scenErr } = await supabase.from('tool_scenarios').insert(scenarioRows);
  if (scenErr) throw scenErr;
}

// 3) 导入系统
const systemRows = systemsSeed.map((s, idx) => ({
  name: s.name || s.system || `系统${idx + 1}`,
  class: (s.class || s.tier || 'A').toUpperCase()
}));
const { error: sysErr } = await supabase.from('systems').insert(systemRows);
if (sysErr) throw sysErr;

// 4) 可选：将下载的 configSeed 中 systems 写入（如果你希望用这份数据）
if (configSeed?.systems?.length) {
  const extraRows = configSeed.systems.map((s, idx) => ({
    name: s.name || `系统${idx + 1}`,
    class: (s.class || 'A').toUpperCase()
  }));
  await supabase.from('systems').insert(extraRows);
}

console.log('Seed completed: tools', toolRows.length, 'scenarios', scenarioRows.length);

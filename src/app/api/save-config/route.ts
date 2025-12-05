import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

const isUUID = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

export async function POST(req: Request) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  try {
    const body = await req.json();
    const sys = body.system;
    const tools = body.tools || [];
    const checkedScenarioIds: string[] = body.checkedScenarioIds || [];
    const expectedUpdatedAt: string | undefined = body.expectedUpdatedAt;
    const taskId: string = body.taskId;
    if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    if (!sys?.id) return NextResponse.json({ error: "Missing system id" }, { status: 400 });

    const now = new Date().toISOString();
    let targetSystemId = sys.id;
    const toolIdMap: Record<string, string> = {};
    const scenarioIdMap: Record<string, string> = {};

    // 1) 系统插入/更新（乐观锁）
    if (!isUUID(sys.id)) {
      // 尝试按名称匹配已有系统，避免重复插入
      const { data: existingByName } = await supabaseService
        .from("systems")
        .select("id")
        .eq("name", sys.name || "")
        .maybeSingle();
      if (existingByName?.id) {
        targetSystemId = existingByName.id;
      } else {
        const { data: inserted, error: insertErr } = await supabaseService
        .from("systems")
        .insert({
          name: sys.name,
          class: sys.tier,
          is_self_built: sys.isSelfBuilt,
          server_coverage: sys.serverCoverage,
          app_coverage: sys.appCoverage,
          server_total: sys.serverTotal,
          server_covered: sys.serverCovered,
          app_total: sys.appTotal,
          app_covered: sys.appCovered,
          documented_items: sys.documentedItems,
          updated_at: now,
          task_id: taskId,
        })
        .select("id,updated_at")
        .single();
        if (insertErr) throw insertErr;
        targetSystemId = inserted.id;
      }
    } else {
      if (expectedUpdatedAt) {
        const { data: latest, error: latestErr } = await supabaseService.from("systems").select("updated_at").eq("id", targetSystemId).maybeSingle();
        if (!latestErr && latest?.updated_at && latest.updated_at !== expectedUpdatedAt) {
          return NextResponse.json({ error: "数据已被其他人更新，请刷新后再保存" }, { status: 409 });
        }
      }
      const { error: sysErr } = await supabaseService
        .from("systems")
        .update({
          name: sys.name,
          class: sys.tier,
          is_self_built: sys.isSelfBuilt,
          server_coverage: sys.serverCoverage,
          app_coverage: sys.appCoverage,
          server_total: sys.serverTotal,
          server_covered: sys.serverCovered,
          app_total: sys.appTotal,
          app_covered: sys.appCovered,
          documented_items: sys.documentedItems,
          updated_at: now,
          task_id: taskId,
        })
        .eq("id", targetSystemId)
        .eq("task_id", taskId);
      if (sysErr) throw sysErr;
    }

    // 2) 处理工具及指标：为新工具/指标生成 uuid，并返回映射
    for (const t of tools) {
      let dbToolId = t.id;
      if (!isUUID(t.id)) {
        // 尝试按名称匹配已有工具
        const { data: existingTool } = await supabaseService.from("tools").select("id").eq("name", t.name || "").eq("task_id", taskId).maybeSingle();
        if (existingTool?.id) {
          dbToolId = existingTool.id;
        } else {
          const { data, error } = await supabaseService
            .from("tools")
            .insert({ name: t.name, default_caps: t.defaultCapabilities || [], updated_at: now, task_id: taskId })
            .select("id")
            .single();
          if (error) throw error;
          dbToolId = data.id;
        }
        toolIdMap[t.id] = dbToolId;
      } else {
        const { error } = await supabaseService
          .from("tools")
          .upsert({ id: dbToolId, name: t.name, default_caps: t.defaultCapabilities || [], updated_at: now, task_id: taskId });
        if (error) throw error;
      }

      await supabaseService.from("tool_scenarios").delete().eq("tool_id", dbToolId).eq("task_id", taskId);
      if (Array.isArray(t.scenarios) && t.scenarios.length) {
        const scenRows = t.scenarios.map((s: any) => {
          const row: any = {
            tool_id: dbToolId,
            category: s.category,
            metric: s.metric,
            threshold: s.threshold || "",
            level: s.level || "gray",
            task_id: taskId,
          };
          if (isUUID(s.id)) row.id = s.id;
          return row;
        });
        const { data: insertedScen, error: scenErr } = await supabaseService
          .from("tool_scenarios")
          .insert(scenRows)
          .select("id,metric");
        if (scenErr) throw scenErr;

        // 记录映射：已存在 uuid 保持不变；新插入按顺序映射非 uuid 输入
        let newIdx = 0;
        t.scenarios.forEach((s: any) => {
          if (isUUID(s.id)) {
            scenarioIdMap[s.id] = s.id;
          } else {
            const generated = insertedScen?.[newIdx]?.id;
            if (generated) scenarioIdMap[s.id] = generated;
            newIdx += 1;
          }
        });
      }
    }

    // 3) 清理旧关联
    await supabaseService.from("system_tools").delete().eq("system_id", targetSystemId).eq("task_id", taskId);
    await supabaseService.from("system_scenarios").delete().eq("system_id", targetSystemId).eq("task_id", taskId);

    // 4) 写入 system_tools（映射后的 UUID）
    const safeToolIds = (sys.selectedToolIds || [])
      .map((tid: string) => toolIdMap[tid] || tid)
      .filter((tid: string) => typeof tid === "string" && isUUID(tid));
    if (safeToolIds.length) {
      const rows = safeToolIds.map((tid: string) => ({
        system_id: targetSystemId,
        tool_id: tid,
        caps_selected: sys.toolCapabilities?.[tid] || sys.toolCapabilities?.[Object.keys(toolIdMap).find((k) => toolIdMap[k] === tid) || ""] || [],
        task_id: taskId,
      }));
      const { error } = await supabaseService.from("system_tools").insert(rows);
      if (error) throw error;
    }

    // 5) 写入 system_scenarios（映射后的 UUID）
    const uuidLike = (v: string) => /^[0-9a-fA-F-]{36}$/.test(v);
    const safeScenarioIds = (checkedScenarioIds || [])
      .map((sid) => scenarioIdMap[sid] || sid)
      .filter((sid) => typeof sid === "string" && uuidLike(sid));
    if (safeScenarioIds.length) {
      const rows = safeScenarioIds.map((sid) => ({
        system_id: targetSystemId,
        scenario_id: sid,
        checked: true,
        task_id: taskId,
      }));
      const { error } = await supabaseService.from("system_scenarios").insert(rows);
      if (error) throw error;
    }

    const { data: latestRow } = await supabaseService.from("systems").select("updated_at").eq("id", targetSystemId).maybeSingle();
    return NextResponse.json({
      ok: true,
      updatedAt: latestRow?.updated_at || now,
      systemId: targetSystemId,
      toolIdMap,
      scenarioIdMap,
    });
  } catch (e: any) {
    console.error("save-config error", e);
    return NextResponse.json({ error: e.message || "save failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

export async function POST(req: Request) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const isUUID = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);
  try {
    const body = await req.json();
    const sys = body.system;
    const tools = body.tools || [];
    const checkedScenarioIds: string[] = body.checkedScenarioIds || [];
    const expectedUpdatedAt: string | undefined = body.expectedUpdatedAt;
    if (!sys?.id) return NextResponse.json({ error: "Missing system id" }, { status: 400 });

    const now = new Date().toISOString();
    let targetSystemId = sys.id;

    // 若 system id 非 UUID，则创建新系统行
    if (!isUUID(sys.id)) {
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
        })
        .select("id,updated_at")
        .single();
      if (insertErr) throw insertErr;
      targetSystemId = inserted.id;
    } else {
      // 乐观锁：如果请求携带 expectedUpdatedAt，则在更新前比对
      if (expectedUpdatedAt) {
        const { data: latest, error: latestErr } = await supabaseService
          .from("systems")
          .select("updated_at")
          .eq("id", targetSystemId)
          .maybeSingle();
        if (!latestErr && latest?.updated_at && latest.updated_at !== expectedUpdatedAt) {
          return NextResponse.json({ error: "数据已被其他人更新，请刷新后再保存" }, { status: 409 });
        }
      }
      const { data: updatedRows, error: sysErr } = await supabaseService
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
        })
        .eq("id", targetSystemId)
        .select("id,updated_at");
      if (sysErr) throw sysErr;
      const updatedAt = updatedRows?.[0]?.updated_at || now;
      // 返回时使用 updatedAt
      // (继续使用 targetSystemId)
    }

    // 清理旧关联
    await supabaseService.from("system_tools").delete().eq("system_id", targetSystemId);
    await supabaseService.from("system_scenarios").delete().eq("system_id", targetSystemId);

    // 写入 system_tools
    if (sys.selectedToolIds?.length) {
      const rows = sys.selectedToolIds.map((tid: string) => ({
        system_id: targetSystemId,
        tool_id: tid,
        caps_selected: sys.toolCapabilities?.[tid] || [],
      }));
      const { error } = await supabaseService.from("system_tools").insert(rows);
      if (error) throw error;
    }

    // 写入 system_scenarios（仅选中的），过滤非法 uuid
    const uuidLike = (v: string) => /^[0-9a-fA-F-]{36}$/.test(v);
    const safeScenarioIds = (checkedScenarioIds || []).filter((sid) => typeof sid === "string" && uuidLike(sid));
    if (safeScenarioIds.length) {
      const rows = safeScenarioIds.map((sid) => ({
        system_id: targetSystemId,
        scenario_id: sid,
        checked: true,
      }));
      const { error } = await supabaseService.from("system_scenarios").insert(rows);
      if (error) throw error;
    }

    const { data: latestRow } = await supabaseService.from("systems").select("updated_at").eq("id", targetSystemId).maybeSingle();
    return NextResponse.json({ ok: true, updatedAt: latestRow?.updated_at || now, systemId: targetSystemId });
  } catch (e: any) {
    console.error("save-config error", e);
    return NextResponse.json({ error: e.message || "save failed" }, { status: 500 });
  }
}
